i18next
  .use(ReactI18next.initReactI18next)
  .init({
    resources: {
      en: window.en,
      nl: window.nl,
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
