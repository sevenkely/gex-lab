"use client";

/**
 * Singleton WebSocket Deribit.
 *
 * Pourquoi un singleton : les pages graphique, accueil et flux affichent toutes
 * un prix BTC/ETH. Une seule connexion, un seul abonnement par canal, et des
 * auditeurs qui reçoivent les ticks.
 *
 * Règles tenues :
 *  - aucune mise à jour React directe : les abonnés écrivent dans des refs et
 *    appliquent au plus une fois par frame (cf. GexChart) ;
 *  - `public/set_heartbeat` + réponse au `heartbeat` (Deribit coupe sinon) ;
 *  - reconnexion avec backoff exponentiel (1 s → 30 s) et réabonnement ;
 *  - état de connexion observable pour afficher un point d'état.
 *
 * Endpoint vérifié : wss://www.deribit.com/ws/api/v2
 * Canal : deribit_price_index.{btc_usd|eth_usd}
 */

import { useEffect, useRef } from "react";

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";
export type TickListener = (price: number, ts: number) => void;
export type StatusListener = (status: SocketStatus) => void;

const URL = "wss://www.deribit.com/ws/api/v2";
const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

class DeribitSocket {
  private socket: WebSocket | null = null;
  private status: SocketStatus = "idle";
  private attempt = 0;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private listeners = new Map<string, Set<TickListener>>();
  private statusListeners = new Set<StatusListener>();
  private subscribed = new Set<string>();
  private requestId = 1;

  subscribe(channel: string, listener: TickListener, onStatus?: StatusListener): () => void {
    const set = this.listeners.get(channel) ?? new Set<TickListener>();
    set.add(listener);
    this.listeners.set(channel, set);
    if (onStatus) {
      this.statusListeners.add(onStatus);
      onStatus(this.status);
    }
    this.ensure(channel);
    return () => {
      set.delete(listener);
      if (onStatus) this.statusListeners.delete(onStatus);
      if (set.size === 0) {
        this.listeners.delete(channel);
        this.subscribed.delete(channel);
        this.send({ jsonrpc: "2.0", id: this.requestId++, method: "public/unsubscribe", params: { channels: [channel] } });
      }
      if (this.listeners.size === 0) this.close();
    };
  }

  private ensure(channel: string): void {
    this.subscribed.add(channel);
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      this.connect();
      return;
    }
    if (this.socket.readyState === WebSocket.OPEN && !this.isSubscribed(channel)) {
      this.sendSubscribe(channel);
    }
  }

  private isSubscribed(channel: string): boolean {
    return this.acknowledged.has(channel);
  }

  private acknowledged = new Set<string>();

  private connect(): void {
    if (typeof window === "undefined") return;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.acknowledged.clear();
      this.setStatus("open");
      this.send({
        jsonrpc: "2.0",
        id: this.requestId++,
        method: "public/set_heartbeat",
        params: { interval: HEARTBEAT_MS / 1000 },
      });
      for (const channel of this.subscribed) this.sendSubscribe(channel);
      this.startHeartbeat();
    };

    socket.onmessage = (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const message = payload as {
        method?: string;
        params?: { channel?: string; data?: { price?: number; timestamp?: number } };
        id?: number;
        result?: unknown;
      };

      // Réponse d'abonnement : on note le canal pour ne pas le redemander.
      if (message.id !== undefined && Array.isArray(message.result)) {
        for (const channel of message.result) {
          if (typeof channel === "string") this.acknowledged.add(channel);
        }
        return;
      }

      if (message.method === "heartbeat") {
        this.send({ jsonrpc: "2.0", id: this.requestId++, method: "public/test" });
        return;
      }

      if (message.method !== "subscription" || !message.params?.channel) return;
      const channel = message.params.channel;
      const data = message.params.data;
      if (!data || typeof data.price !== "number") return;
      const price = data.price;
      const ts = data.timestamp ?? Date.now();
      for (const listener of this.listeners.get(channel) ?? []) listener(price, ts);
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      this.acknowledged.clear();
      this.socket = null;
      if (this.listeners.size === 0) {
        this.setStatus("closed");
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose suit systématiquement : la reconnexion y est planifiée.
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(this.attempt - 1, 5));
    this.setStatus("reconnecting");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.listeners.size > 0) this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ jsonrpc: "2.0", id: this.requestId++, method: "public/test" });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendSubscribe(channel: string): void {
    this.send({
      jsonrpc: "2.0",
      id: this.requestId++,
      method: "public/subscribe",
      params: { channels: [channel] },
    });
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private close(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempt = 0;
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

const instance = typeof window !== "undefined" ? new DeribitSocket() : null;

/** Abonne un composant au prix temps réel d'un indice Deribit. */
export function useDeribitPriceIndex(
  index: "btc_usd" | "eth_usd" | null,
  onTick: TickListener,
  onStatus?: StatusListener,
): void {
  const tickRef = useRef(onTick);
  const statusRef = useRef(onStatus);
  useEffect(() => {
    tickRef.current = onTick;
    statusRef.current = onStatus;
  });

  useEffect(() => {
    if (!index || !instance) return;
    const channel = `deribit_price_index.${index}`;
    return instance.subscribe(
      channel,
      (price, ts) => tickRef.current(price, ts),
      (status) => statusRef.current?.(status),
    );
  }, [index]);
}
