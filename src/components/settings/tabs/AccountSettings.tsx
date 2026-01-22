import { useRef } from 'react';
import { useLanguage } from '@/shared/providers/language-provider';
import { Camera, User } from 'lucide-react';

import type { SettingsTabProps } from '../types';

export function AccountSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onSettingsChange({
          ...settings,
          profile: {
            ...settings.profile,
            avatar: reader.result as string,
          },
        });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          {t.settings.manageProfile}
        </p>
      </div>

      {/* Avatar */}
      <div className="space-y-3">
        <label className="text-foreground text-sm font-medium">
          {t.settings.avatar}
        </label>
        <div className="flex items-center gap-4">
          <button
            onClick={handleAvatarClick}
            className="bg-muted border-border hover:border-primary/50 group relative size-20 cursor-pointer overflow-hidden rounded-full border-2 border-dashed transition-colors"
          >
            {settings.profile.avatar ? (
              <img
                src={settings.profile.avatar}
                alt="Avatar"
                className="size-full object-cover"
              />
            ) : (
              <User className="text-muted-foreground absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="size-5 text-white" />
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            className="hidden"
          />
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">
              {t.settings.clickToUpload}
            </p>
            <p className="text-muted-foreground/70 text-xs">
              {t.settings.avatarRecommendation}
            </p>
          </div>
        </div>
      </div>

      {/* Nickname */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.nickname}
        </label>
        <input
          type="text"
          value={settings.profile.nickname}
          onChange={(e) =>
            onSettingsChange({
              ...settings,
              profile: {
                ...settings.profile,
                nickname: e.target.value,
              },
            })
          }
          placeholder={t.settings.enterNickname}
          className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring block h-10 w-full max-w-sm rounded-lg border px-3 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
        />
      </div>
    </div>
  );
}
