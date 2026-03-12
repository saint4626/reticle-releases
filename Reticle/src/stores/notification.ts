import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface NotificationAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface Notification {
  id: string;
  title?: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'update';
  duration?: number;
  actions?: NotificationAction[];
}

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<Notification[]>([]);

  function add(
    message: string, 
    type: 'success' | 'error' | 'info' | 'update' = 'info', 
    duration = 3000,
    options: { title?: string; actions?: NotificationAction[] } = {}
  ) {
    const id = Date.now().toString() + Math.random().toString();
    notifications.value.push({ 
      id, 
      message, 
      type, 
      duration,
      title: options.title,
      actions: options.actions
    });

    if (duration > 0) {
      setTimeout(() => {
        remove(id);
      }, duration);
    }
  }

  function remove(id: string) {
    notifications.value = notifications.value.filter(n => n.id !== id);
  }

  return {
    notifications,
    add,
    remove
  };
});
