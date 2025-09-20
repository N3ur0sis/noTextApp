const { withAndroidManifest } = require('@expo/config-plugins');

const withFirebaseNotificationFix = (config) => {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    
    // Find the application element
    const application = androidManifest.manifest.application[0];
    
    // Find the firebase notification color meta-data
    if (application['meta-data']) {
      const metaDataArray = application['meta-data'];
      
      for (let i = 0; i < metaDataArray.length; i++) {
        const metaData = metaDataArray[i];
        if (metaData.$['android:name'] === 'com.google.firebase.messaging.default_notification_color') {
          // Add tools:replace attribute
          metaData.$['tools:replace'] = 'android:resource';
          break;
        }
      }
    }
    
    // Ensure tools namespace is declared
    if (!androidManifest.manifest.$['xmlns:tools']) {
      androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    
    return config;
  });
};

module.exports = withFirebaseNotificationFix;
