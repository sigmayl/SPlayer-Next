<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import type { OnlinePlatform } from "@shared/types/platform";
const status = useStatusStore();
const { t } = useI18n();
const options = computed(() => [
  { value: "netease", label: t("settings.onlinePlatform.netease") },
  { value: "qqmusic", label: t("settings.onlinePlatform.qqmusic") },
]);
</script>

<template>
  <div class="w-48 shrink-0">
    <SSelect
      :model-value="status.onlinePlatform"
      :options="options"
      @update:model-value="status.onlinePlatform = $event as OnlinePlatform"
    />
  </div>
</template>
