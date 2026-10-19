/**
 * Transition de page : fondu + translation à chaque navigation.
 * (Un `template` remonte à chaque changement de route, contrairement au layout.)
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full animate-[rise_450ms_var(--ease)_backwards]">{children}</div>
  );
}
