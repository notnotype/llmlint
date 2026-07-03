import {watch} from "vue";
import {useWebSettings} from "../composables/useWebSettings";

export default defineNuxtPlugin(() => {
    const {settings} = useWebSettings();
    watch(() => settings.value.locale, (locale) => {
        document.documentElement.lang = locale;
    }, {immediate: true});
});
