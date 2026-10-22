"use client";

/**
 * Pont ATAS — client WebSocket partagé et hook React.
 *
 * Pourquoi un singleton par URL (et pas un socket par graphique) : le pont
 * ATAS est un serveur qui diffuse tous les alias (NQ, ES, GC). Une seule
 * connexion suffit ; changer d'actif ou d'unité de temps ne fait que changer
 * d'abonné. C'est aussi ce qui évite la double connexion de React Strict Mode :
 * le socket n'est fermé qu'après un court délai lorsqu'il n'a plus d'abonné,
 * donc le remontage immédiat le réutilise.
 *
 * Règles :
 *  - aucune erreur ne remonte à l'interface : hors ligne est un état normal ;
 *  - reconnexion toutes les 2 s, sans backoff agressif (pont local) ;
 *  - le snapshot est rejoué à chaque abonnement, pas seulement à l'ouverture ;
 *  - les messages sont filtrés par symbole et validés avant de toucher au
 *    graphique (cf. `atas.ts`).
 */

import { useEffect, useRef } from "react";
import type { Candle } from "@/server/providers/types";
import { inferPeriodSeconds, parseAtasBar, toCandle } from "../atas";

export type AtasStatus = "idle" | "connecting" | "open" | "offline";

export type AtasEvent =
  | { type: "snapshot"; bars: readonly Candle[]; period: number | null }
  | { type: "bar"; bar: Candle; period: number | null };

type BarListener = (event: AtasEvent) => void;
type StatusListener = (status: AtasStatus) => void;

const RETRY_MS = 2_000;
/** Laisse à Strict Mode le temps de remonter avant de fermer le socket. */
const CLOSE_GRACE_MS = 300;
/** Fenêtre pendant laquelle le snapshot initial est accumulé puis rejoué. */
const PRIME_MS = 200;
const MAX_BUFFER = 2_000;

export const ATAS_WS_URL =
  process.env.NEXT_PUBLIC_ATAS_WS_URL || "ws://localhost:8080/ws/";

class AtasSocket {
  private socket: WebSocket | null = null;
  private status: AtasStatus = "idle";
  private retryTimer: number | null = null;
  private closeTimer: number | null = null;
  private primeTimer: number | null = null;
  private priming = false;
  private attempt = 0;
  private readonly buffer = new Map<string, Map<number, Candle>>();
  private readonly periods = new Map<string, number>();
  private readonly listeners = new Map<string, Set<BarListener>>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(private readonly url: string) {}

  subscribe(symbol: string, onEvent: BarListener, onStatus?: StatusListener): () => void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    const set = this.listeners.get(symbol) ?? new Set<BarListener>();
    set.add(onEvent);
    this.listeners.set(symbol, set);
    if (onStatus) {
      this.statusListeners.add(onStatus);
      onStatus(this.status);
    }

    const snapshot = this.snapshotFor(symbol);
    if (snapshot) onEvent(snapshot);
    this.ensure();

    return () => {
      set.delete(onEvent);
      if (set.size === 0) this.listeners.delete(symbol);
      if (onStatus) this.statusListeners.delete(onStatus);
      if (this.listeners.size === 0) this.scheduleClose();
    };
  }

  private snapshotFor(symbol: string): AtasEvent | null {
    const candles = this.buffer.get(symbol);
    if (!candles || candles.size === 0) return null;
    const bars = [...candles.values()].sort((a, b) => a.time - b.time);
    const period = this.periods.get(symbol) ?? inferPeriodSeconds(bars);
    if (period !== null) this.periods.set(symbol, period);
    return { type: "snapshot", bars, period };
  }

  private ensure(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    if (this.retryTimer !== null) return;
    this.connect();
  }

  private connect(): void {
    if (typeof window === "undefined") return;
    this.setStatus(this.attempt === 0 ? "connecting" : "offline");

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus("open");
      this.startPriming();
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.receive(event.data);
    };

    socket.onerror = () => {
      // `onclose` suit systématiquement : c'est lui qui planifie la reprise.
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPriming();
      if (this.listeners.size === 0) {
        this.setStatus("idle");
        return;
      }
      this.scheduleRetry();
    };
  }

  private receive(raw: unknown): void {
    if (typeof raw !== "string") return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const bar = parseAtasBar(payload);
    if (!bar) return;

    const candles = this.buffer.get(bar.s) ?? new Map<number, Candle>();
    // Changement d'unité de temps dans ATAS : les anciennes bougies ne sont
    // plus comparables, on repart du nouveau flux.
    const knownPeriod = this.periods.get(bar.s);
    if (bar.p && knownPeriod && bar.p !== knownPeriod) {
      candles.clear();
      this.periods.delete(bar.s);
    }

    const candle = toCandle(bar);
    candles.set(candle.time, candle);
    if (candles.size > MAX_BUFFER) {
      let oldest = Number.POSITIVE_INFINITY;
      for (const time of candles.keys()) if (time < oldest) oldest = time;
      candles.delete(oldest);
    }
    this.buffer.set(bar.s, candles);
    if (bar.p) this.periods.set(bar.s, bar.p);
    const period = this.periods.get(bar.s) ?? inferPeriodSeconds([...candles.values()]);
    if (period !== null) this.periods.set(bar.s, period);

    // Le snapshot arrive en rafale à l'ouverture : on l'accumule puis on
    // l'envoie en un seul événement, au lieu de 500 fusions successives.
    if (this.priming) return;
    for (const listener of this.listeners.get(bar.s) ?? []) {
      listener({ type: "bar", bar: candle, period });
    }
  }

  private startPriming(): void {
    this.priming = true;
    if (this.primeTimer !== null) window.clearTimeout(this.primeTimer);
    this.primeTimer = window.setTimeout(() => {
      this.primeTimer = null;
      this.priming = false;
      for (const symbol of this.listeners.keys()) {
        const snapshot = this.snapshotFor(symbol);
        if (!snapshot) continue;
        for (const listener of this.listeners.get(symbol) ?? []) listener(snapshot);
      }
    }, PRIME_MS);
  }

  private stopPriming(): void {
    this.priming = false;
    if (this.primeTimer !== null) {
      window.clearTimeout(this.primeTimer);
      this.primeTimer = null;
    }
  }

  private scheduleRetry(): void {
    this.setStatus("offline");
    if (this.retryTimer !== null) return;
    this.attempt += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.listeners.size > 0 && !this.socket) this.connect();
    }, RETRY_MS);
  }

  private scheduleClose(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.closeTimer !== null) return;
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (this.listeners.size > 0) return;
      this.stopPriming();
      const socket = this.socket;
      this.socket = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // Le socket était déjà fermé : rien à faire.
        }
      }
      this.attempt = 0;
      this.setStatus("idle");
    }, CLOSE_GRACE_MS);
  }

  private setStatus(status: AtasStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

const sockets = new Map<string, AtasSocket>();

function socketFor(url: string): AtasSocket {
  let socket = sockets.get(url);
  if (!socket) {
    socket = new AtasSocket(url);
    sockets.set(url, socket);
  }
  return socket;
}

/**
 * Abonne le graphique au pont ATAS pour un alias (`NQ`, `ES`, `GC`).
 * `symbol = null` coupe l'abonnement (crypto : le flux Deribit reste seul).
 */
export function useAtasLive(
  symbol: string | null,
  onEvent: (event: AtasEvent) => void,
  onStatus?: (status: AtasStatus) => void,
): void {
  const eventRef = useRef(onEvent);
  const statusRef = useRef(onStatus);

  useEffect(() => {
    eventRef.current = onEvent;
    statusRef.current = onStatus;
  });

  useEffect(() => {
    if (!symbol || typeof window === "undefined") return;
    return socketFor(ATAS_WS_URL).subscribe(
      symbol,
      (event) => eventRef.current(event),
      (status) => statusRef.current?.(status),
    );
  }, [symbol]);
}
