'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { useAuthStore, User } from '@/lib/store/authStore'

export type UserProfile = {
  _id: string
  id?: string
  username: string
  email: string
  discriminator: string
  avatar?: string | null
  banner?: string | null
  bio?: string
  status?: 'online' | 'idle' | 'dnd' | 'offline'
  customStatus?: string
  isVerified?: boolean
  displayName?: string | null
  pronouns?: string | null
  themeColor?: string | null
  cardStyle?: string | null
  fontStyle?: string | null
  location?: string | null
  showBanner?: boolean
  privacySettings?: any
  socialLinks?: any
}

type ProfileResponse = {
  success?: boolean
  user?: UserProfile
  username?: string
  email?: string
  avatar?: string
  banner?: string
  bio?: string
  _id?: string
  id?: string
  isVerified?: boolean
  displayName?: string | null
  pronouns?: string | null
  themeColor?: string | null
  cardStyle?: string | null
  fontStyle?: string | null
  location?: string | null
  showBanner?: boolean
  privacySettings?: any
  socialLinks?: any
}

export function useProfile() {
  const { setUser } = useAuthStore()
  
  // For httpOnly cookies, we can't check document.cookie
  // Instead, we always try to fetch if we're not on auth pages
  const isAuthPage = typeof window !== 'undefined' && (
    window.location.pathname.includes('/login') ||
    window.location.pathname.includes('/signup')
  )

  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      console.log('Fetching user profile...')
      try {
        const response = await apiGet<ProfileResponse>('/auth/profile')
        console.log('Profile response:', response)
        
        // Handle different response formats
        let user: UserProfile | null = null;

        if (response.user) {
          user = {
            ...response.user,
            _id: response.user._id || response.user.id || ''
          } as UserProfile
        } else if (response._id || response.id) {
          // Fallback for flat response
          user = {
            _id: response._id || response.id || '',
            username: response.username || '',
            email: response.email || '',
            discriminator: '0000',
            avatar: response.avatar,
            banner: response.banner,
            bio: response.bio,
            isVerified: response.isVerified,
            displayName: response.displayName,
            pronouns: response.pronouns,
            themeColor: response.themeColor,
            cardStyle: response.cardStyle,
            fontStyle: response.fontStyle,
            location: response.location,
            showBanner: response.showBanner,
            privacySettings: response.privacySettings,
            socialLinks: response.socialLinks
          } as UserProfile
        }

        console.log('Parsed user:', user)
        
        // Sync with auth store
        if (user) {
          const authUser: User = {
            id: user._id || user.id || '',
            username: user.username,
            email: user.email,
            discriminator: user.discriminator,
            avatar: user.avatar || null,
            banner: user.banner || null,
            bio: user.bio || null,
            status: user.status || 'offline',
            customStatus: user.customStatus || null,
            isVerified: user.isVerified || false,
            displayName: user.displayName || null,
            pronouns: user.pronouns || null,
            themeColor: user.themeColor || '#5865F2',
            cardStyle: user.cardStyle || 'rounded',
            fontStyle: user.fontStyle || 'default',
            location: user.location || null,
            showBanner: user.showBanner !== false,
            privacySettings: user.privacySettings || {},
            socialLinks: user.socialLinks || {}
          }
          setUser(authUser)
        }
        
        return user
        
      } catch (error: any) {
        console.error('❌ Profile fetch error:', error)
        // Clear auth store on error
        setUser(null)
        throw error
      }
    },
    enabled: !isAuthPage, // Always try to fetch if not on auth page
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    throwOnError: false,
  })
}
