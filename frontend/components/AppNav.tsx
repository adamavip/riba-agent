import Link from "next/link";
import { BarChart3Icon, MessageSquareTextIcon, SproutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function AppNav() {
  return (
    <header className="sticky top-0 z-40 border-border border-b bg-background/95 backdrop-blur">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link className="flex items-center gap-2 font-semibold" href="/">
          <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-700 text-white">
            <SproutIcon className="size-4" />
          </span>
          <span>Riba Agent</span>
        </Link>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/">
              <BarChart3Icon className="size-4" />
              Platform
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/chat">
              <MessageSquareTextIcon className="size-4" />
              Open chat
            </Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
