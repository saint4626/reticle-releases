import { ref } from 'vue';
import { COUNTDOWN_SECONDS, COUNTDOWN_TICK_MS, TIMER_TICK_MS } from '../utils/constants';

/**
 * Composable for countdown and recording duration timer logic.
 * Extracted from the video store to reduce its size and improve testability.
 */
export function useRecordingTimer() {
    const isCountingDown = ref(false);
    const countdownValue = ref(COUNTDOWN_SECONDS);
    const recordingDuration = ref(0);
    const recordingTimer = ref<number | null>(null);

    /**
     * Run a 3-2-1 countdown. Resolves when countdown reaches 0.
     * Sets `isCountingDown` to true during the countdown.
     */
    function runCountdown(): Promise<void> {
        isCountingDown.value = true;
        countdownValue.value = COUNTDOWN_SECONDS;

        return new Promise<void>((resolve) => {
            const timer = setInterval(() => {
                countdownValue.value--;
                if (countdownValue.value <= 0) {
                    clearInterval(timer);
                    resolve();
                }
            }, COUNTDOWN_TICK_MS);
        });
    }

    /** Cancel an active countdown */
    function cancelCountdown() {
        isCountingDown.value = false;
    }

    /** Mark countdown as finished */
    function finishCountdown() {
        isCountingDown.value = false;
    }

    /** Start a recording duration timer */
    function startTimer(initialValue = 0) {
        if (recordingTimer.value) clearInterval(recordingTimer.value);
        recordingDuration.value = initialValue;
        recordingTimer.value = setInterval(() => {
            recordingDuration.value++;
        }, TIMER_TICK_MS) as unknown as number;
    }

    /** Stop the recording duration timer */
    function stopTimer() {
        if (recordingTimer.value) {
            clearInterval(recordingTimer.value);
            recordingTimer.value = null;
        }
    }

    return {
        isCountingDown,
        countdownValue,
        recordingDuration,
        runCountdown,
        cancelCountdown,
        finishCountdown,
        startTimer,
        stopTimer
    };
}
