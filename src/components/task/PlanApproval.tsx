import type { TaskPlan } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { Check, ListTodo, Play, X } from 'lucide-react';

interface PlanApprovalProps {
  plan: TaskPlan;
  isWaitingApproval: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}

export function PlanApproval({
  plan,
  isWaitingApproval,
  onApprove,
  onReject,
}: PlanApprovalProps) {
  // Check if all steps are completed
  const isAllCompleted = plan.steps.every(
    (step) => step.status === 'completed'
  );

  return (
    <div
      className={cn(
        'space-y-4 rounded-xl border p-4',
        isAllCompleted && !isWaitingApproval
          ? 'border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20'
          : 'border-primary/30 bg-accent/30'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-foreground flex items-center gap-2 text-sm font-medium">
          {isAllCompleted && !isWaitingApproval ? (
            <Check className="size-4 text-emerald-500" />
          ) : (
            <ListTodo className="text-primary size-4" />
          )}
          执行计划
          {isWaitingApproval ? (
            <span className="bg-primary/20 text-primary rounded-full px-2 py-0.5 text-xs">
              待确认
            </span>
          ) : isAllCompleted ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              已完成
            </span>
          ) : null}
        </div>
      </div>

      {/* Goal */}
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">目标</p>
        <p className="text-foreground text-sm">{plan.goal}</p>
      </div>

      {/* Steps */}
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">
          步骤 ({plan.steps.length})
        </p>
        <div className="space-y-2">
          {plan.steps.map((step, index) => (
            <div key={step.id} className="flex items-start gap-2.5">
              {/* Step number or status indicator */}
              <div
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-xs font-medium transition-colors',
                  step.status === 'completed'
                    ? 'bg-primary border-primary text-primary-foreground'
                    : step.status === 'in_progress'
                      ? 'border-primary bg-primary/10 text-primary'
                      : step.status === 'failed'
                        ? 'border-destructive bg-destructive/10 text-destructive'
                        : 'border-muted-foreground/30 bg-background text-muted-foreground'
                )}
              >
                {step.status === 'completed' ? (
                  <Check className="size-3" />
                ) : step.status === 'in_progress' ? (
                  <div className="bg-primary size-1.5 animate-pulse rounded-full" />
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={cn(
                  'min-w-0 flex-1 text-sm leading-snug',
                  step.status === 'completed'
                    ? 'text-muted-foreground'
                    : step.status === 'in_progress'
                      ? 'text-foreground font-medium'
                      : step.status === 'failed'
                        ? 'text-destructive'
                        : 'text-foreground'
                )}
              >
                {step.description}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      {plan.notes && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">备注</p>
          <p className="text-muted-foreground text-sm">{plan.notes}</p>
        </div>
      )}

      {/* Action buttons - only show when waiting for approval */}
      {isWaitingApproval && onApprove && onReject && (
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onReject}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            <X className="size-4" />
            取消
          </button>
          <button
            onClick={onApprove}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm transition-colors"
          >
            <Play className="size-4" />
            开始执行
          </button>
        </div>
      )}
    </div>
  );
}
