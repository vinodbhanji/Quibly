'use client'

import { useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { useSocket } from '@/providers/SocketProvider'
import { useProfile } from '@/hooks/queries'
import { useNotificationStore } from '@/lib/store/notificationStore'
import { useUIStore } from '@/lib/store/uiStore'
import { Message } from '@/hooks/queries'

/**
 * Plays a short double-ping notification chime using the Web Audio API.
 * This is completely local — no network request, no CORS issues.
 */
function playNotificationChime() {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContext) return
    const ctx = new AudioContext()

    const playTone = (startTime: number, freq: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, startTime)
      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25)
      osc.start(startTime)
      osc.stop(startTime + 0.25)
    }

    // Double ping: 880Hz then 1100Hz
    playTone(ctx.currentTime, 880)
    playTone(ctx.currentTime + 0.15, 1100)

    // Close audio context after sounds finish
    setTimeout(() => ctx.close(), 1000)
  } catch (e) {
    // Silently ignore — audio is best-effort
  }
}

/**
 * Parses the pathname to extract serverId and channelId.
 * Supports both server channels (/channels/serverId/channelId)
 * and DM rooms (/channels/@me/dmRoomId).
 */
function parseActiveChannel(pathname: string): { channelId: string | null; serverId: string | null } {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'channels') return { channelId: null, serverId: null }
  const slug = parts.slice(1)
  const segment0 = slug[0] ?? null // serverId or '@me'
  const segment1 = slug[1] ?? null // channelId or dmRoomId
  const isMe = segment0 === '@me'
  return {
    channelId: segment1,
    serverId: isMe ? null : segment0,
  }
}

export function NotificationManager() {
  const { socket, isConnected } = useSocket()
  const { data: currentUser } = useProfile()
  const { incrementUnread, incrementMention, clearNotifications } = useNotificationStore()
  const { selectedChannelId } = useUIStore()
  const router = useRouter()
  const pathname = usePathname()

  // Request desktop notification permission once on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission()
      }
    }
  }, [])

  // Auto-clear unread badges whenever the user navigates to a channel
  useEffect(() => {
    const { channelId, serverId } = parseActiveChannel(pathname)
    if (channelId) {
      clearNotifications(channelId, serverId ?? undefined)
    }
  }, [pathname, clearNotifications])

  // Auto-clear unread badge when window/tab is focused and user is on a channel
  useEffect(() => {
    const handleFocus = () => {
      const { channelId, serverId } = parseActiveChannel(window.location.pathname)
      if (channelId) {
        clearNotifications(channelId, serverId ?? undefined)
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [clearNotifications])

  // Main socket message handler
  useEffect(() => {
    if (!socket || !isConnected || !currentUser) return

    const handleReceiveMessage = (incoming: any) => {
      const msg = incoming as Message
      const msgTargetId = msg.channelId || msg.dmRoomId
      if (!msgTargetId) return

      // --- SELF CHECK: Don't notify sender ---
      const senderId = typeof msg.senderId === 'object'
        ? (msg.senderId as any)._id || (msg.senderId as any).id
        : msg.senderId
      const currentUserId = currentUser._id || (currentUser as any).id
      if (senderId && currentUserId && senderId === currentUserId) return

      // --- ACTIVE CHANNEL CHECK: Don't notify if already viewing this channel ---
      const { channelId: activeChannelId } = parseActiveChannel(pathname)
      const effectiveActiveId = selectedChannelId || activeChannelId
      if (msgTargetId === effectiveActiveId && !document.hidden) return

      // --- MUTE CHECK: Respect per-channel notification settings ---
      const store = useNotificationStore.getState()
      const channelSettings = store.settings?.channelSettings?.[msgTargetId] ?? { muted: false }
      if (channelSettings.muted) return

      // --- MENTION CHECK ---
      const isMentioned =
        store.checkMention(msg.content || '', currentUser.username, msgTargetId) ||
        !!(msg as any).mentions?.includes(currentUserId)

      // --- INCREMENT UNREAD / MENTION COUNT ---
      if (isMentioned) {
        incrementMention(msgTargetId, (msg as any).serverId)
      } else {
        incrementUnread(msgTargetId, (msg as any).serverId)
      }

      // --- SOUND ---
      if (store.settings?.enableSounds !== false) {
        playNotificationChime()
      }

      const senderName = typeof msg.senderId === 'object'
        ? (msg.senderId as any).username || 'Someone'
        : 'Someone'
      const senderAvatar = typeof msg.senderId === 'object'
        ? (msg.senderId as any).avatar ?? undefined
        : undefined

      // --- DESKTOP PUSH when tab is hidden ---
      if (document.hidden && store.settings?.enableDesktopNotifications !== false) {
        store.showBrowserNotification(
          isMentioned ? `${senderName} mentioned you` : `New message from ${senderName}`,
          msg.type === 'FILE' ? 'Sent a file' : msg.content || '',
          senderAvatar
        )
      }

      // --- IN-APP TOAST ---
      const redirectUrl = msg.channelId
        ? `/channels/${(msg as any).serverId}/${msg.channelId}`
        : `/channels/@me/${msg.dmRoomId}`

      toast.custom((t) => (
        <div
          className="bg-[#2b2d31] border border-[#1e1f22] p-4 rounded-lg shadow-2xl flex items-start gap-4 cursor-pointer hover:bg-[#35373c] transition-colors min-w-[320px] animate-in slide-in-from-right duration-300"
          onClick={() => {
            router.push(redirectUrl)
            toast.dismiss(t)
          }}
        >
          <div className="w-10 h-10 rounded-full bg-[#5865f2] flex items-center justify-center text-white font-bold flex-shrink-0 overflow-hidden">
            {senderAvatar ? (
              <img src={senderAvatar} className="w-full h-full rounded-full object-cover" alt={senderName} />
            ) : (
              senderName[0]?.toUpperCase() ?? '?'
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center mb-1">
              <span className="font-bold text-white text-sm">{senderName}</span>
              <span className="text-[10px] text-[#949ba4]">
                {isMentioned ? 'Mentioned you' : 'New Message'}
              </span>
            </div>
            <p className="text-[#dbdee1] text-sm truncate">
              {msg.type === 'FILE' ? '📎 Sent a file' : msg.content}
            </p>
          </div>
        </div>
      ), {
        position: 'bottom-right',
        duration: 5000,
      })
    }

    socket.on('receive_message', handleReceiveMessage)

    return () => {
      socket.off('receive_message', handleReceiveMessage)
    }
  }, [socket, isConnected, currentUser, selectedChannelId, pathname, incrementUnread, incrementMention, router])

  // No DOM output needed
  return null
}
