import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';

const languages = [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'id', label: 'Indonesia', flag: '🇮🇩' },
] as const;

export function LanguageSwitcher({ variant = 'default' }: { variant?: 'default' | 'compact' }) {
    const { i18n } = useTranslation();
    const current = languages.find((l) => l.code === i18n.language) || languages[0];

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {variant === 'compact' ? (
                    <Button variant="outline" size="sm" className="gap-2 rounded-full border-border/60 bg-background/80 px-3.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-all hover:bg-accent hover:shadow-md">
                        <Globe className="size-3.5 text-muted-foreground" />
                        <span className="text-sm">{current.flag}</span>
                        <span>{current.label}</span>
                    </Button>
                ) : (
                    <SidebarMenuButton className="text-neutral-600 hover:text-neutral-800 dark:text-neutral-300 dark:hover:text-neutral-100">
                        <Globe className="h-5 w-5" />
                        <span>{current.flag} {current.label}</span>
                    </SidebarMenuButton>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
                {languages.map((lang) => (
                    <DropdownMenuItem
                        key={lang.code}
                        onClick={() => i18n.changeLanguage(lang.code)}
                        className={`gap-2 ${i18n.language === lang.code ? 'bg-accent' : ''}`}
                    >
                        <span className="text-sm">{lang.flag}</span>
                        <span>{lang.label}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
