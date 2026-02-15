import { useState } from 'react';
import type { Task } from '@/shared/db';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  Info,
  Monitor,
} from 'lucide-react';

import { VirtualComputer } from '@/components/task/VirtualComputer';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { useSidebar } from './sidebar-context';

type TabType = 'details' | 'computer';

interface RightSidebarProps {
  task: Task | null;
  messages: AgentMessage[];
  isRunning: boolean;
}

// Collapsible Section Component
function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-border border-b">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="hover:bg-accent/50 flex w-full items-center justify-between p-4 text-left transition-colors"
      >
        <span className="text-foreground text-sm font-medium">{title}</span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 transition-transform',
            !isOpen && '-rotate-90'
          )}
        />
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export function RightSidebar({ task, messages, isRunning }: RightSidebarProps) {
  const { rightOpen, toggleRight, setRightOpen, leftActiveTab } = useSidebar();
  const [activeTab, setActiveTab] = useState<TabType>('computer');

  // Calculate stats
  const resultMsg = messages.find((m) => m.type === 'result');
  const cost = task?.cost ?? resultMsg?.cost;
  const duration = task?.duration ?? resultMsg?.duration;
  const displayStatus = task?.status || (isRunning ? 'running' : 'completed');

  // Status configuration
  const statusConfig: Record<
    string,
    { color: string; label: string; bgColor: string }
  > = {
    running: {
      color: 'text-secondary',
      label: 'Running',
      bgColor: 'bg-secondary/20',
    },
    completed: {
      color: 'text-primary',
      label: 'Completed',
      bgColor: 'bg-primary/20',
    },
    error: {
      color: 'text-destructive',
      label: 'Error',
      bgColor: 'bg-destructive/20',
    },
    stopped: {
      color: 'text-muted-foreground',
      label: 'Stopped',
      bgColor: 'bg-muted',
    },
  };
  const status =
    statusConfig[isRunning ? 'running' : displayStatus] || statusConfig.running;

  // Tab switcher component - only show for local tasks
  const tabSwitcher = leftActiveTab === 'local' && (
    <div className="border-border flex items-center gap-1 border-b p-2">
      <button
        onClick={() => setActiveTab('computer')}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          activeTab === 'computer'
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        )}
      >
        <Monitor className="size-4" />
        <span>Computer</span>
      </button>
      <button
        onClick={() => setActiveTab('details')}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          activeTab === 'details'
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        )}
      >
        <Info className="size-4" />
        <span>Details</span>
      </button>
    </div>
  );

  // Details content (original sidebar content)
  const detailsContent = (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Progress Section */}
      <CollapsibleSection title="Progress">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium',
              status.bgColor,
              status.color
            )}
          >
            <span
              className={cn(
                'size-2 rounded-full',
                isRunning ? 'bg-secondary animate-pulse' : 'bg-current'
              )}
            />
            {status.label}
          </span>
        </div>
        {task?.prompt && (
          <p className="text-muted-foreground mt-3 line-clamp-2 text-sm">
            {task.prompt}
          </p>
        )}
      </CollapsibleSection>

      {/* Artifacts Section */}
      <CollapsibleSection title="Artifacts" defaultOpen={false}>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="border-border mb-3 rounded-lg border border-dashed p-4">
            <BarChart3 className="text-muted-foreground/50 size-8" />
          </div>
          <p className="text-muted-foreground text-xs">
            Outputs created during the task land here.
          </p>
        </div>
      </CollapsibleSection>

      {/* Context Section */}
      <CollapsibleSection title="Context" defaultOpen={true}>
        <div className="space-y-3">
          {/* Selected Folders */}
          <div>
            <div className="text-muted-foreground flex items-center justify-between text-xs">
              <span className="flex items-center gap-1">
                <ChevronDown className="size-3" />
                Selected folders
              </span>
              <span>1</span>
            </div>
            <div className="bg-accent/50 mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
              <Folder className="text-muted-foreground size-4" />
              <span className="text-foreground truncate">Current Project</span>
            </div>
          </div>

          {/* Working Files */}
          <div>
            <p className="text-muted-foreground text-xs">Working files</p>
            <div className="mt-2 space-y-1">
              {messages
                .filter((m) => m.type === 'tool_use' && m.name === 'Read')
                .slice(0, 5)
                .map((m, i) => {
                  const input = m.input as Record<string, unknown> | undefined;
                  const filePath = input?.file_path as string | undefined;
                  const fileName = filePath?.split('/').pop() || 'Unknown file';
                  return (
                    <div
                      key={i}
                      className="text-muted-foreground hover:bg-accent/50 flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                    >
                      <FileText className="size-4 shrink-0" />
                      <span className="truncate">{fileName}</span>
                    </div>
                  );
                })}
              {messages.filter(
                (m) => m.type === 'tool_use' && m.name === 'Read'
              ).length === 0 && (
                <p className="text-muted-foreground/70 text-xs italic">
                  No files accessed yet
                </p>
              )}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Stats Section */}
      <CollapsibleSection title="Stats" defaultOpen={true}>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Messages</span>
            <span className="text-foreground">{messages.length}</span>
          </div>
          {cost !== undefined && cost !== null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Cost</span>
              <span className="text-foreground">${cost.toFixed(4)}</span>
            </div>
          )}
          {duration !== undefined && duration !== null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Duration</span>
              <span className="text-foreground">
                {(duration / 1000).toFixed(1)}s
              </span>
            </div>
          )}
          {task && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Created</span>
              <span className="text-foreground text-xs">
                {new Date(task.created_at).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );

  // Full sidebar content with tabs (for local tasks) or just details (for bot chats)
  const sidebarContent = (
    <div className="flex h-full flex-col">
      {tabSwitcher}
      <div className="flex-1 overflow-hidden">
        {leftActiveTab === 'local' ? (
          // Local tasks: show Computer or Details based on activeTab
          activeTab === 'computer' ? (
            <div className="h-full p-3">
              <div className="border-border/50 h-full overflow-hidden rounded-xl border shadow-sm">
                <VirtualComputer messages={messages} isRunning={isRunning} />
              </div>
            </div>
          ) : (
            detailsContent
          )
        ) : (
          // Bot chats: always show details view
          detailsContent
        )}
      </div>
    </div>
  );

  return (
    <TooltipProvider>
      {/* Toggle Button (Desktop) */}
      <div className="hidden items-start pt-3 lg:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleRight}
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-6 items-center justify-center rounded-md transition-colors"
            >
              {rightOpen ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {rightOpen ? 'Hide panel' : 'Show panel'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'border-border bg-background/50 hidden flex-col border-l transition-all duration-300 lg:flex',
          rightOpen ? 'w-80' : 'w-0 overflow-hidden'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Sheet */}
      <Sheet open={false} onOpenChange={(open) => setRightOpen(open)}>
        <SheetContent side="right" className="w-80 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Task Details</SheetTitle>
          </SheetHeader>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
