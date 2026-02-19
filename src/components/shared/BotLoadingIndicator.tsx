import { Logo } from '@/components/common/logo';

export function BotLoadingIndicator() {
  return (
    <div className="flex items-center gap-3 py-2">
      <Logo />
      <div className="flex gap-1">
        <div className="bg-foreground/30 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.3s]" />
        <div className="bg-foreground/30 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.15s]" />
        <div className="bg-foreground/30 h-2 w-2 animate-bounce rounded-full" />
      </div>
    </div>
  );
}
