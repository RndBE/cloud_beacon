import AppLogoIcon from '@/components/app-logo-icon';

export default function AppLogo() {
    return (
        <div className="flex w-full items-center justify-center">
            <AppLogoIcon className="h-10 w-full max-w-[180px] object-contain dark:brightness-0 dark:invert" />
        </div>
    );
}
