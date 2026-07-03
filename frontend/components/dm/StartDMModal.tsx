'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Search, MessageSquare, Loader2, Users } from 'lucide-react'
import { useFriends } from '@/hooks/queries'
import { apiGet, apiPost } from '@/lib/api'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface StartDMModalProps {
  open: boolean
  onClose: () => void
}

interface SearchUser {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  status: 'online' | 'idle' | 'dnd' | 'offline'
}

export default function StartDMModal({ open, onClose }: StartDMModalProps) {
  const router = useRouter()
  const { data: friends = [], isLoading: friendsLoading } = useFriends()
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchUser[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([])
      return
    }

    const delayDebounce = setTimeout(async () => {
      setSearching(true)
      try {
        const response = await apiGet<{ success: boolean; users: SearchUser[] }>(
          `/users?search=${encodeURIComponent(search.trim())}`
        )
        if (response.success && response.users) {
          setSearchResults(response.users)
        }
      } catch (error) {
        console.error('Failed to search users:', error)
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => clearTimeout(delayDebounce)
  }, [search])

  const handleStartDM = async (userId: string) => {
    setLoadingUserId(userId)
    try {
      const response = await apiPost<{ success: boolean; room: { id: string } }>('/dm/room', { userId })
      if (response.success && response.room) {
        router.push(`/channels/@me/${response.room.id}`)
        onClose()
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to start conversation')
    } finally {
      setLoadingUserId(null)
    }
  }

  // Determine list of users to display
  const displayUsers = search.trim() ? searchResults : friends.map(f => ({
    id: f.id,
    username: f.username,
    discriminator: f.discriminator,
    avatar: f.avatar || null,
    status: f.status
  }))

  const statusColors = {
    online: 'bg-[#23a55a]',
    idle: 'bg-[#f0b232]',
    dnd: 'bg-[#f23f43]',
    offline: 'bg-[#80848e]'
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[440px] bg-[#313338] border border-[#1e1f22] text-white p-0 overflow-hidden rounded-lg shadow-2xl">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#5865f2]" />
            Direct Messages
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-4 space-y-4">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#949ba4]" />
            <input
              placeholder="Search by username..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#1e1f22] text-[#dbdee1] rounded-[4px] p-2.5 pl-10 outline-none border border-transparent focus:border-[#5865f2] text-sm transition-colors"
              autoFocus
            />
          </div>

          {/* User List */}
          <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e1f22] scrollbar-track-transparent space-y-1 pr-1">
            {searching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-[#5865f2] animate-spin" />
              </div>
            ) : displayUsers.length === 0 ? (
              <div className="text-center py-8 text-[#949ba4] flex flex-col items-center gap-2">
                <Users className="w-8 h-8 opacity-40" />
                <span className="text-sm">
                  {search.trim() ? 'No users found matching query' : 'Your friends list is empty'}
                </span>
              </div>
            ) : (
              displayUsers.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleStartDM(user.id)}
                  disabled={loadingUserId !== null}
                  className="w-full text-left px-3 py-2 rounded hover:bg-[#35373c] transition-colors flex items-center gap-3 group disabled:opacity-50"
                >
                  <div className="relative flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-[#5865f2] flex items-center justify-center text-sm font-bold text-white overflow-hidden">
                      {user.avatar ? (
                        <img src={user.avatar} className="w-full h-full object-cover" alt="" />
                      ) : (
                        user.username[0].toUpperCase()
                      )}
                    </div>
                    <div className={`absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-[3px] border-[#313338] ${
                      statusColors[user.status] || statusColors.offline
                    }`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[15px] truncate flex items-center gap-1.5 text-white">
                      <span>{user.username}</span>
                      <span className="text-xs text-[#949ba4]">#{user.discriminator}</span>
                    </div>
                  </div>

                  {loadingUserId === user.id ? (
                    <Loader2 className="w-4 h-4 text-[#949ba4] animate-spin" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-[#949ba4] opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
