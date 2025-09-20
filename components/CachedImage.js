import { Image } from 'expo-image'
import React, { useEffect, useState } from 'react'
import { unifiedMediaService } from '../services/unifiedMediaService'

const CachedImage = ({ source, priority = 'normal', ...props }) => {
  const [resolvedSource, setResolvedSource] = useState(null)

  useEffect(() => {
    let mounted = true

    const resolve = async () => {
      try {
        const uri = source?.uri
        if (!uri) {
          if (mounted) setResolvedSource(null)
          return
        }

        // Our internal schemes
        if (uri.startsWith('sb://media/')) {
          const objectKey = uri.slice('sb://media/'.length)
          const local = await unifiedMediaService.getLocalPathFromObjectKey(objectKey, 'image', priority)
          if (mounted) setResolvedSource({ uri: local })
        } else if (uri.startsWith('sb://thumbs/')) {
          const objectKey = uri.slice('sb://thumbs/'.length)
          const local = await unifiedMediaService.getLocalPathFromObjectKey(objectKey, 'thumbnail', priority)
          if (mounted) setResolvedSource({ uri: local })
        }
        // Old signed URLs still work (first view → download, then local)
        else if (uri.includes('/media/')) {
          const local = await unifiedMediaService.getCachedFile(uri, 'image', priority)
          if (mounted) setResolvedSource({ uri: local })
        }
        // Already local or app asset
        else {
          if (mounted) setResolvedSource(source)
        }
      } catch (e) {
        if (__DEV__) console.warn('❌ [CACHED_IMAGE] resolve error:', e?.message)
        if (mounted) setResolvedSource(source)
      }
    }

    resolve()
    return () => { mounted = false }
  }, [source?.uri, priority])

  if (!resolvedSource) return null

  // We render a local file:// most of the time — no need for extra memory cache
  return (
    <Image
      source={resolvedSource}
      cachePolicy="none"
      allowDownscaling={false}
      priority={priority}
      recyclingKey={resolvedSource?.uri}
      {...props}
    />
  )
}

// Preload = just trigger the local download ONCE (no expo-image prefetch on network)
CachedImage.preload = async (urlOrSb) => {
  if (!urlOrSb) return
  try {
    if (urlOrSb.startsWith('sb://media/')) {
      const key = urlOrSb.slice('sb://media/'.length)
      await unifiedMediaService.getLocalPathFromObjectKey(key, 'image')
    } else if (urlOrSb.startsWith('sb://thumbs/')) {
      const key = urlOrSb.slice('sb://thumbs/'.length)
      await unifiedMediaService.getLocalPathFromObjectKey(key, 'thumbnail')
    } else if (urlOrSb.includes('/media/')) {
      await unifiedMediaService.getCachedFile(urlOrSb, 'image')
    }
  } catch (e) {
    if (__DEV__) console.log('🔍 [CACHED_IMAGE] preload skip:', e?.message)
  }
}

export default CachedImage
