import { StatusBar } from 'expo-status-bar'
import { Platform, View } from 'react-native'
import { Colors } from '../constants/Design'
import { getSafeAreaTop } from '../utils/responsive'

// Platform-specific StatusBar configuration
export const AppStatusBar = ({ style = 'light', backgroundColor = Colors.black }) => {
  if (Platform.OS === 'ios') {
    return (
      <StatusBar 
        style={style}
        backgroundColor="transparent"
        translucent={false}
        networkActivityIndicatorVisible={true}
      />
    )
  }

  // Android: Handle edge-to-edge with proper status bar background
  return (
    <>
      <StatusBar 
        style={style}
        backgroundColor="transparent"
        translucent={true}
      />
      {/* Render background view under status bar for Android edge-to-edge */}
      <View 
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: getSafeAreaTop(),
          backgroundColor: backgroundColor,
          zIndex: 999
        }} 
      />
    </>
  )
}

export default AppStatusBar
