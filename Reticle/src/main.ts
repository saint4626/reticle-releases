import { createApp } from "vue";
import i18n from './i18n';
import { createPinia } from "pinia";
import "./styles/fonts.css";
import "./styles/main.css";
import App from "./App.vue";
import { useVideoHistoryStore } from "./stores/videoHistory";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(i18n);

// Initialize videoHistory store before mounting App
(async () => {
  const videoHistoryStore = useVideoHistoryStore();
  await videoHistoryStore.init();
  app.mount("#app");
})();
