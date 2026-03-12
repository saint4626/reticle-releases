// src/i18n.ts
import { createI18n } from 'vue-i18n';

// Импортируем словари (лучше держать их в отдельных файлах)
import en from './locales/en.json';
import ru from './locales/ru.json';
import es from './locales/es.json';
import it from './locales/it.json';
import ptBR from './locales/pt-BR.json';
import de from './locales/de.json';

// Определяем язык браузера/системы по умолчанию
const systemLang = navigator.language.split('-')[0];
const supportedLangs = ['en', 'ru', 'es', 'it', 'pt', 'de'];
const defaultLocale = supportedLangs.includes(systemLang) ? systemLang : (navigator.language === 'pt-BR' ? 'pt-BR' : 'en');

const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('locale') || defaultLocale,
  fallbackLocale: 'en',
  messages: {
    en,
    ru,
    es,
    it,
    de,
    'pt-BR': ptBR
  }
});

export default i18n;