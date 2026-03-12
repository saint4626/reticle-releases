import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

export const useViewportStore = defineStore('viewport', () => {
  // Для примитивов (чисел, строк, булевых значений) ref() работает идеально
  const scale = ref(1);
  
  // ОПТИМИЗАЦИЯ: shallowRef для объекта.
  // Vue не будет создавать Proxy для 'x' и 'y'. 
  // Реактивность сработает только при полной замене объекта.
  const translate = shallowRef({ x: 0, y: 0 });

  function reset() {
    scale.value = 1;
    // Создаем новый объект — shallowRef это заметит и обновит интерфейс
    translate.value = { x: 0, y: 0 };
  }

  function setScale(newScale: number) {
    // Clamp scale between 0.1 (10%) and 5 (500%)
    scale.value = Math.min(Math.max(0.1, newScale), 5);
  }

  function setTranslate(x: number, y: number) {
    // И здесь тоже создается новый объект, реактивность работает быстро и четко
    translate.value = { x, y };
  }

  return {
    scale,
    translate,
    reset,
    setScale,
    setTranslate
  };
});