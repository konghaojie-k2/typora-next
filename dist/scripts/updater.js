/**
 * Typora Next - Auto Updater
 * Uses tauri-plugin-updater for GitHub Release based updates
 */

(function() {
  'use strict';

  // ============================================
  // Update Checker
  // ============================================
  const Updater = {
    /**
     * Check for available updates.
     * @returns {Promise<{available: boolean, version?: string, date?: string, body?: string, downloadAndInstall?: Function}>}
     */
    async check() {
      if (!window.__TAURI__) {
        console.log('[Updater] Not in Tauri environment, skipping update check');
        return { available: false };
      }

      try {
        const { invoke } = window.__TAURI__.core;
        // IPC command registered by tauri-plugin-updater
        const result = await invoke('plugin:updater|check');

        if (!result) {
          return { available: false };
        }

        // result is an Update resource — extract its fields
        return {
          available: true,
          version: result.version,
          date: result.date,
          body: result.body,
          currentVersion: result.currentVersion,
          rawJson: result.rawJson,
          rid: result.rid,
          async downloadAndInstall(onEvent) {
            await invoke('plugin:updater|download_and_install', {
              rid: this.rid,
              onEvent: onEvent ? createChannel(onEvent) : undefined
            });
          }
        };
      } catch (err) {
        // Updater not configured (missing pubkey, no endpoint) — not an error, just no updates
        if (err && typeof err === 'string' && err.includes('updater')) {
          console.log('[Updater] Not configured:', err);
          return { available: false, error: '未配置更新服务' };
        }
        console.warn('[Updater] Check failed:', err);
        return { available: false, error: String(err) };
      }
    },

    /**
     * Restart the application (call after install).
     */
    async restart() {
      if (!window.__TAURI__) return;
      try {
        const { invoke } = window.__TAURI__.core;
        await invoke('plugin:process|restart');
      } catch (err) {
        console.error('[Updater] Restart failed:', err);
      }
    }
  };

  // Helper: create a Tauri Channel from a callback
  function createChannel(callback) {
    try {
      // Channel is available via window.__TAURI__
      if (window.__TAURI__ && window.__TAURI__.core) {
        // Use the Channel API if available (Tauri 2)
        if (typeof window.__TAURI__.core.Channel === 'function') {
          const channel = new window.__TAURI__.core.Channel();
          channel.onmessage = callback;
          return channel;
        }
      }
    } catch (e) {
      console.warn('[Updater] Channel creation failed:', e);
    }
    return undefined;
  }

  // Expose globally
  window.Updater = Updater;
})();
