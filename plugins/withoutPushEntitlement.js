/**
 * withoutPushEntitlement.js -- strip the iOS `aps-environment` entitlement.
 *
 * expo-notifications adds `aps-environment` (REMOTE push), but Sentinel only uses
 * LOCAL notifications today (intercept alerts), which do NOT require it. Our EAS
 * provisioning profile's App ID has no Push Notifications capability, so the App
 * Store build fails signing ("profile doesn't include the aps-environment
 * entitlement"). Removing the entitlement makes the app's entitlements match the
 * (no-push) profile, so it signs — local notifications are unaffected.
 *
 * TO RE-ENABLE REMOTE PUSH (for C2 "push on detection"): enable Push Notifications
 * on the App ID in the Apple Developer portal, regenerate the provisioning profile
 * (eas credentials), and remove this plugin from app.json.
 */
const { withEntitlementsPlist } = require('@expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    if (cfg.modResults && 'aps-environment' in cfg.modResults) {
      delete cfg.modResults['aps-environment'];
    }
    return cfg;
  });
};
