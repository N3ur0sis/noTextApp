import { Camera } from "expo-camera";
import * as Linking from "expo-linking";
import { Alert } from "react-native";

export const ensureVideoPermissions = async () => {
  
  // — Caméra —
  let cam = await Camera.getCameraPermissionsAsync();
  
  if (cam.canAskAgain && cam.status !== "granted") {
    cam = await Camera.requestCameraPermissionsAsync();
  }

  // — Micro —
  let mic = await Camera.getMicrophonePermissionsAsync();
  
  if (mic.canAskAgain && mic.status !== "granted") {
    mic = await Camera.requestMicrophonePermissionsAsync();
  }

  // — Toujours pas accordé ? —
  if (cam.status !== "granted" || mic.status !== "granted") {
    
    Alert.alert(
      "Permissions requises",
      "Active la caméra et le micro pour enregistrer une vidéo.",
      [
        { text: "Annuler", style: "cancel" },
        { text: "Ouvrir Réglages", onPress: () => Linking.openSettings() },
      ]
    );
    return false;
  }

  return true;
};
