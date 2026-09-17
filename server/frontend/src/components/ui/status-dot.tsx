'use client';

import { useLocale } from '@/components/locale-provider';

type LivenessStatus = 'alive' | 'dead' | 'unknown';
type WorkingStatus = 'working' | 'not-working' | 'untested';
type Status = LivenessStatus | WorkingStatus;

const STATUS_CLASSES: Record<Status, string> = {
  alive: 'bg-signal-green',
  working: 'bg-signal-green',
  dead: 'bg-signal-red',
  'not-working': 'bg-signal-red',
  unknown: 'bg-muted-foreground/40',
  untested: 'bg-muted-foreground/40',
};

const STATUS_LABELS: Record<'ar' | 'en' | 'fr', Record<Status, string>> = {
  ar: {
    alive: 'متاح',
    working: 'يعمل',
    dead: 'متوقف',
    'not-working': 'لا يعمل',
    unknown: 'غير معروف',
    untested: 'لم يُختبر',
  },
  en: {
    alive: 'Alive',
    working: 'Working',
    dead: 'Dead',
    'not-working': 'Not Working',
    unknown: 'Unknown',
    untested: 'Untested',
  },
  fr: {
    alive: 'actif',
    working: 'actif',
    dead: 'inactif',
    'not-working': 'inactif',
    unknown: 'inconnu',
    untested: 'non testé',
  },
};

interface StatusDotProps {
  status: Status;
  label?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export default function StatusDot({
  status,
  label,
  showLabel = true,
  size = 'sm',
  className = '',
}: StatusDotProps) {
  const { locale } = useLocale();
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  const displayLabel = label ?? STATUS_LABELS[locale][status];

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`${dotSize} rounded-full shrink-0 ${STATUS_CLASSES[status]}`}
        aria-hidden="true"
      />
      {showLabel && displayLabel ? (
        <span className="text-xs text-muted-foreground capitalize">{displayLabel}</span>
      ) : (
        <span className="sr-only">{displayLabel || status}</span>
      )}
    </span>
  );
}
