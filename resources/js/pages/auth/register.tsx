import { Form, Head } from '@inertiajs/react';
import { Mail, LockKeyhole, User, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import InputError from '@/components/input-error';
import PasswordInput from '@/components/password-input';
import TextLink from '@/components/text-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import AuthLayout from '@/layouts/auth-layout';
import { login } from '@/routes';
import { store } from '@/routes/register';

export default function Register() {
    const { t } = useTranslation();

    return (
        <AuthLayout
            title={t('auth.create_account_title')}
            description={t('auth.get_started')}
        >
            <Head title={t('auth.create_account')} />
            <Form
                {...store.form()}
                resetOnSuccess={['password', 'password_confirmation']}
                disableWhileProcessing
                className="flex flex-col gap-5"
            >
                {({ processing, errors }) => (
                    <>
                        <div className="grid gap-4">
                            {/* Name */}
                            <div className="grid gap-2">
                                <Label htmlFor="name">{t('auth.full_name')}</Label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        id="name"
                                        type="text"
                                        required
                                        autoFocus
                                        tabIndex={1}
                                        autoComplete="name"
                                        name="name"
                                        placeholder="John Doe"
                                        className="pl-10"
                                    />
                                </div>
                                <InputError
                                    message={errors.name}
                                />
                            </div>

                            {/* Email */}
                            <div className="grid gap-2">
                                <Label htmlFor="email">{t('auth.email_address')}</Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        id="email"
                                        type="email"
                                        required
                                        tabIndex={2}
                                        autoComplete="email"
                                        name="email"
                                        placeholder="email@example.com"
                                        className="pl-10"
                                    />
                                </div>
                                <InputError message={errors.email} />
                            </div>

                            {/* Password */}
                            <div className="grid gap-2">
                                <Label htmlFor="password">{t('auth.password')}</Label>
                                <div className="relative">
                                    <LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <PasswordInput
                                        id="password"
                                        required
                                        tabIndex={3}
                                        autoComplete="new-password"
                                        name="password"
                                        placeholder="••••••••"
                                        className="pl-10"
                                    />
                                </div>
                                <InputError message={errors.password} />
                            </div>

                            {/* Confirm Password */}
                            <div className="grid gap-2">
                                <Label htmlFor="password_confirmation">
                                    {t('auth.confirm_password')}
                                </Label>
                                <div className="relative">
                                    <ShieldCheck className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <PasswordInput
                                        id="password_confirmation"
                                        required
                                        tabIndex={4}
                                        autoComplete="new-password"
                                        name="password_confirmation"
                                        placeholder="••••••••"
                                        className="pl-10"
                                    />
                                </div>
                                <InputError
                                    message={errors.password_confirmation}
                                />
                            </div>

                            {/* Submit */}
                            <Button
                                type="submit"
                                className="mt-2 w-full"
                                size="lg"
                                tabIndex={5}
                                data-test="register-user-button"
                            >
                                {processing && <Spinner />}
                                {t('auth.create_account')}
                            </Button>
                        </div>

                        <div className="text-center text-sm text-muted-foreground">
                            {t('auth.already_have_account')}{' '}
                            <TextLink href={login()} tabIndex={6}>
                                {t('auth.sign_in')}
                            </TextLink>
                        </div>
                    </>
                )}
            </Form>
        </AuthLayout>
    );
}
