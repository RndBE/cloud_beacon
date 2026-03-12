import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import id from '@/locales/id.json';

const savedLanguage = typeof window !== 'undefined'
    ? localStorage.getItem('language') || 'en'
    : 'en';

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        id: { translation: id },
    },
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false,
    },
});

i18n.on('languageChanged', (lng) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem('language', lng);
    }
});

export default i18n;
