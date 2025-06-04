"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import {
  Download,
  Pause,
  Play,
  Square,
  Video,
  Monitor,
  AppWindowIcon as Window,
  Chrome,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Settings,
  Radio,
  Clock,
  Save,
  Trash2,
  RotateCcw,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import { Separator } from "@/components/ui/separator"

interface RecordingSettings {
  screenSource: "screen" | "window" | "tab"
  includeSystemAudio: boolean
  includeMicrophone: boolean
  videoQuality: "low" | "medium" | "high" | "ultra"
  frameRate: number
  audioBitrate: number
  backgroundRecording: boolean
  bufferDuration: 1 | 3 | 5 // minutes
}

interface AudioLevels {
  system: number
  microphone: number
}

interface BufferChunk {
  data: Blob
  timestamp: number
  index: number
}

export default function AdvancedScreenRecorder() {
  const [recording, setRecording] = useState<boolean>(false)
  const [paused, setPaused] = useState<boolean>(false)
  const [backgroundRecording, setBackgroundRecording] = useState<boolean>(false)
  const [videoURL, setVideoURL] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recordingTime, setRecordingTime] = useState<number>(0)
  const [bufferTime, setBufferTime] = useState<number>(0)
  const [audioLevels, setAudioLevels] = useState<AudioLevels>({ system: 0, microphone: 0 })
  const [bufferSize, setBufferSize] = useState<number>(0)

  const [settings, setSettings] = useState<RecordingSettings>({
    screenSource: "screen",
    includeSystemAudio: true,
    includeMicrophone: false,
    videoQuality: "medium", // Lower quality for better performance
    frameRate: 30,
    audioBitrate: 128,
    backgroundRecording: false,
    bufferDuration: 3,
  })

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const backgroundRecorderRef = useRef<MediaRecorder | null>(null)
  const backgroundStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const bufferChunksRef = useRef<BufferChunk[]>([])
  const chunkIndexRef = useRef<number>(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const bufferTimerRef = useRef<NodeJS.Timeout | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  const { toast } = useToast()

  // Timer effect for regular recording
  useEffect(() => {
    if (recording && !paused) {
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1)
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [recording, paused])

  // Timer effect for background recording
  useEffect(() => {
    if (backgroundRecording) {
      bufferTimerRef.current = setInterval(() => {
        setBufferTime((prev) => prev + 1)
        setBufferSize(bufferChunksRef.current.length)
        cleanupOldBufferChunks()
      }, 1000)
    } else {
      if (bufferTimerRef.current) {
        clearInterval(bufferTimerRef.current)
      }
      setBufferTime(0)
      setBufferSize(0)
    }

    return () => {
      if (bufferTimerRef.current) {
        clearInterval(bufferTimerRef.current)
      }
    }
  }, [backgroundRecording])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && recording) {
        mediaRecorderRef.current.stop()
      }
      if (backgroundRecorderRef.current && backgroundRecording) {
        backgroundRecorderRef.current.stop()
      }
      if (backgroundStreamRef.current) {
        backgroundStreamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (videoURL) {
        URL.revokeObjectURL(videoURL)
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [recording, backgroundRecording, videoURL])

  const cleanupOldBufferChunks = () => {
    const now = Date.now()
    const maxAge = settings.bufferDuration * 60 * 1000

    const oldLength = bufferChunksRef.current.length
    bufferChunksRef.current = bufferChunksRef.current.filter((chunk) => now - chunk.timestamp <= maxAge)

    if (oldLength !== bufferChunksRef.current.length) {
      console.log(`Cleaned up ${oldLength - bufferChunksRef.current.length} old chunks`)
    }
  }

  const getVideoConstraints = () => {
    const qualitySettings = {
      low: { width: 1280, height: 720 },
      medium: { width: 1920, height: 1080 },
      high: { width: 2560, height: 1440 },
      ultra: { width: 3840, height: 2160 },
    }

    return {
      cursor: "always",
      frameRate: settings.frameRate,
      ...qualitySettings[settings.videoQuality],
    }
  }

  const getDisplayMediaConstraints = () => {
    const constraints: DisplayMediaStreamConstraints = {
      video: getVideoConstraints(),
      audio: settings.includeSystemAudio,
    }

    if (settings.screenSource === "tab") {
      constraints.preferCurrentTab = true
    }

    return constraints
  }

  const getVideoBitrate = () => {
    const bitrateMap = {
      low: 1000000,
      medium: 2500000,
      high: 5000000,
      ultra: 10000000,
    }
    return bitrateMap[settings.videoQuality]
  }

  const startRecording = async () => {
    setError(null)
    chunksRef.current = []
    setVideoURL(null)
    setRecordingTime(0)

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia(getDisplayMediaConstraints())
      let finalStream = displayStream

      if (settings.includeMicrophone) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              sampleRate: 44100,
            },
          })

          const audioContext = new AudioContext()
          const destination = audioContext.createMediaStreamDestination()

          if (displayStream.getAudioTracks().length > 0) {
            const displaySource = audioContext.createMediaStreamSource(displayStream)
            displaySource.connect(destination)
          }

          const micSource = audioContext.createMediaStreamSource(micStream)
          micSource.connect(destination)

          const videoTrack = displayStream.getVideoTracks()[0]
          const audioTrack = destination.stream.getAudioTracks()[0]

          finalStream = new MediaStream([videoTrack, audioTrack])
        } catch (micError) {
          console.warn("Microphone access failed:", micError)
          toast({
            title: "Microphone access failed",
            description: "Recording will continue without microphone audio.",
            variant: "destructive",
          })
        }
      }

      const options: MediaRecorderOptions = {
        mimeType: "video/webm",
        audioBitsPerSecond: settings.audioBitrate * 1000,
        videoBitsPerSecond: getVideoBitrate(),
      }

      const mediaRecorder = new MediaRecorder(finalStream, options)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" })
        const url = URL.createObjectURL(blob)
        setVideoURL(url)
        setRecording(false)
        setPaused(false)
        setRecordingTime(0)

        finalStream.getTracks().forEach((track) => track.stop())

        if (audioContextRef.current) {
          audioContextRef.current.close()
        }

        toast({
          title: "Recording completed",
          description: "Your screen recording is ready to download.",
        })
      }

      mediaRecorder.onerror = (event) => {
        console.error("Recording error:", event)
        setError("Recording error occurred")
        setRecording(false)
        setPaused(false)
      }

      mediaRecorder.start(1000)
      setRecording(true)

      toast({
        title: "Recording started",
        description: `Recording ${settings.screenSource} with ${settings.videoQuality} quality.`,
      })
    } catch (err) {
      console.error("Error starting recording:", err)
      setError("Failed to start recording. Please make sure you've granted the necessary permissions.")
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
    }
  }

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause()
      setPaused(true)
      toast({
        title: "Recording paused",
        description: "Your screen recording has been paused.",
      })
    }
  }

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume()
      setPaused(false)
      toast({
        title: "Recording resumed",
        description: "Your screen recording has been resumed.",
      })
    }
  }

  const downloadRecording = () => {
    if (videoURL) {
      const a = document.createElement("a")
      a.href = videoURL
      a.download = `screen-recording-${new Date().toISOString().slice(0, 19)}.webm`
      a.click()
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const startBackgroundRecording = async () => {
    console.log("=== Starting background recording ===")
    setError(null)

    try {
      // Clear any existing data
      bufferChunksRef.current = []
      chunkIndexRef.current = 0
      setBufferTime(0)
      setBufferSize(0)

      console.log("Requesting display media...")

      // Get display media with minimal constraints first
      const constraints = {
        video: true,
        audio: settings.includeSystemAudio,
      }

      console.log("Display media constraints:", constraints)
      const displayStream = await navigator.mediaDevices.getDisplayMedia(constraints)

      console.log("✅ Got display stream:", {
        videoTracks: displayStream.getVideoTracks().length,
        audioTracks: displayStream.getAudioTracks().length,
        id: displayStream.id,
      })

      // Store the stream reference
      backgroundStreamRef.current = displayStream

      // Create MediaRecorder with the most basic options
      console.log("Creating MediaRecorder...")
      let mediaRecorder: MediaRecorder

      try {
        // Try with basic webm first
        mediaRecorder = new MediaRecorder(displayStream, { mimeType: "video/webm" })
        console.log("✅ Created MediaRecorder with video/webm")
      } catch (e) {
        console.log("video/webm failed, trying default...")
        // Fallback to default
        mediaRecorder = new MediaRecorder(displayStream)
        console.log("✅ Created MediaRecorder with default settings")
      }

      backgroundRecorderRef.current = mediaRecorder

      // Set up event handlers with detailed logging
      mediaRecorder.onstart = () => {
        console.log("🎬 MediaRecorder started")
        setBackgroundRecording(true)
        toast({
          title: "Background recording started",
          description: "Screen capture is now active in the background.",
        })
      }

      mediaRecorder.ondataavailable = (event) => {
        const size = event.data?.size || 0
        console.log(`📦 Data available: ${size} bytes at ${new Date().toISOString()}`)

        if (event.data && size > 0) {
          const chunk: BufferChunk = {
            data: event.data,
            timestamp: Date.now(),
            index: chunkIndexRef.current++,
          }

          bufferChunksRef.current.push(chunk)
          console.log(`✅ Added chunk ${chunk.index}, total: ${bufferChunksRef.current.length}`)

          // Update UI immediately
          setBufferSize(bufferChunksRef.current.length)
        } else {
          console.log("⚠️ Received empty data chunk")
        }
      }

      mediaRecorder.onstop = () => {
        console.log("🛑 MediaRecorder stopped")
        setBackgroundRecording(false)
        setBufferTime(0)
        setBufferSize(0)

        // Clean up stream
        if (backgroundStreamRef.current) {
          backgroundStreamRef.current.getTracks().forEach((track) => {
            console.log(`Stopping track: ${track.kind}`)
            track.stop()
          })
          backgroundStreamRef.current = null
        }

        toast({
          title: "Background recording stopped",
          description: "Screen capture has been stopped.",
        })
      }

      mediaRecorder.onerror = (event) => {
        console.error("❌ MediaRecorder error:", event)
        const error = event.error || event
        setError(`Recording error: ${error.message || "Unknown error"}`)
        setBackgroundRecording(false)

        // Clean up on error
        if (backgroundStreamRef.current) {
          backgroundStreamRef.current.getTracks().forEach((track) => track.stop())
          backgroundStreamRef.current = null
        }
      }

      // Add stream ended handler
      displayStream.getVideoTracks()[0].onended = () => {
        console.log("📺 Video track ended (user stopped sharing)")
        setBackgroundRecording(false)
        setError("Screen sharing was stopped by user")
      }

      // Start recording with 1 second intervals
      console.log("🚀 Starting MediaRecorder with 1000ms timeslice...")
      mediaRecorder.start(1000)

      console.log("=== Background recording setup complete ===")
    } catch (err) {
      console.error("❌ Failed to start background recording:", err)

      let errorMessage = "Failed to start background recording"
      if (err.name === "NotAllowedError") {
        errorMessage = "Permission denied. Please allow screen sharing."
      } else if (err.name === "NotSupportedError") {
        errorMessage = "Screen recording not supported in this browser."
      } else if (err.message) {
        errorMessage = `Error: ${err.message}`
      }

      setError(errorMessage)
      setBackgroundRecording(false)

      // Clean up any partial setup
      if (backgroundStreamRef.current) {
        backgroundStreamRef.current.getTracks().forEach((track) => track.stop())
        backgroundStreamRef.current = null
      }
    }
  }

  const stopBackgroundRecording = () => {
    console.log("=== Stopping background recording ===")

    try {
      if (backgroundRecorderRef.current) {
        console.log("Stopping MediaRecorder...")
        backgroundRecorderRef.current.stop()
        backgroundRecorderRef.current = null
      }

      if (backgroundStreamRef.current) {
        console.log("Stopping stream tracks...")
        backgroundStreamRef.current.getTracks().forEach((track) => {
          console.log(`Stopping ${track.kind} track`)
          track.stop()
        })
        backgroundStreamRef.current = null
      }

      // Clear buffer
      bufferChunksRef.current = []
      chunkIndexRef.current = 0
      setBufferSize(0)
      setBufferTime(0)

      console.log("✅ Background recording stopped successfully")
    } catch (err) {
      console.error("❌ Error stopping background recording:", err)
    }
  }

  const captureLastMinutes = (minutes: number | null = null) => {
    console.log(`Capturing last ${minutes || "all"} minutes...`)
    console.log(`Total chunks available: ${bufferChunksRef.current.length}`)

    if (bufferChunksRef.current.length === 0) {
      toast({
        title: "No data available",
        description: "No recording data found in buffer.",
        variant: "destructive",
      })
      return
    }

    // Sort chunks by index to ensure proper order
    const sortedChunks = [...bufferChunksRef.current].sort((a, b) => a.index - b.index)
    console.log(
      "Sorted chunks:",
      sortedChunks.map((c) => ({ index: c.index, size: c.data.size, timestamp: c.timestamp })),
    )

    let chunksToUse: BufferChunk[]

    if (minutes === null) {
      // Use all chunks
      chunksToUse = sortedChunks
    } else {
      // Calculate cutoff time for specific duration
      const now = Date.now()
      const cutoffTime = now - minutes * 60 * 1000

      // Filter chunks by timestamp
      chunksToUse = sortedChunks.filter((chunk) => chunk.timestamp >= cutoffTime)

      if (chunksToUse.length === 0) {
        toast({
          title: "No data available",
          description: `Not enough buffer data for ${minutes} minute(s).`,
          variant: "destructive",
        })
        return
      }
    }

    console.log(`Using ${chunksToUse.length} chunks for capture`)

    // Extract blob data in correct order
    const blobData = chunksToUse.map((chunk) => chunk.data)
    const totalSize = blobData.reduce((sum, blob) => sum + blob.size, 0)
    console.log(`Total blob size: ${totalSize} bytes`)

    // Create blob with proper MIME type
    const blob = new Blob(blobData, { type: "video/webm" })
    console.log(`Final blob size: ${blob.size} bytes`)

    // Create URL for the blob
    const url = URL.createObjectURL(blob)

    // Clean up previous video URL
    if (videoURL) {
      URL.revokeObjectURL(videoURL)
    }

    setVideoURL(url)

    const duration = minutes ? `${minutes} minute(s)` : "all available buffer"
    toast({
      title: "Capture saved",
      description: `Last ${duration} captured successfully.`,
    })

    console.log(`Capture completed: ${chunksToUse.length} chunks, ${duration}`)
  }

  const clearBuffer = () => {
    console.log("Clearing buffer...")
    bufferChunksRef.current = []
    chunkIndexRef.current = 0
    setBufferSize(0)
    setBufferTime(0)

    toast({
      title: "Buffer cleared",
      description: "Recording buffer has been cleared.",
    })
  }

  const updateSettings = (key: keyof RecordingSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }))

    if (key === "bufferDuration" && backgroundRecording) {
      // Don't restart, just let the cleanup handle the new duration
      cleanupOldBufferChunks()
    }
  }

  // Calculate available capture options
  const getAvailableCaptures = () => {
    if (bufferChunksRef.current.length === 0) return []

    const now = Date.now()
    const sortedChunks = [...bufferChunksRef.current].sort((a, b) => a.timestamp - b.timestamp)
    const oldestChunk = sortedChunks[0]
    const availableTime = (now - oldestChunk.timestamp) / 1000 / 60 // in minutes

    const captures = []
    if (availableTime >= 0.5) captures.push(1)
    if (availableTime >= 2.5) captures.push(3)
    if (availableTime >= 4.5) captures.push(5)

    return captures
  }

  const availableCaptures = getAvailableCaptures()

  return (
    <div className="w-full space-y-6">
      {/* Recording Status Bar */}
      {recording && (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse"></div>
                  <span className="font-medium text-red-700 dark:text-red-300">{paused ? "PAUSED" : "RECORDING"}</span>
                </div>
                <Badge variant="secondary" className="font-mono">
                  {formatTime(recordingTime)}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Background Recording Status Bar */}
      {backgroundRecording && (
        <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-blue-500 animate-pulse"></div>
                  <span className="font-medium text-blue-700 dark:text-blue-300">BACKGROUND RECORDING</span>
                </div>
                <Badge variant="secondary" className="font-mono">
                  {formatTime(bufferTime)}
                </Badge>
                <Badge variant="outline">{bufferSize} chunks</Badge>
                <Badge variant="outline">{settings.bufferDuration}min max</Badge>
              </div>

              <div className="flex items-center gap-2">
                {bufferSize > 0 && (
                  <Button size="sm" variant="default" onClick={() => captureLastMinutes(null)} className="text-xs">
                    <Save className="mr-1 h-3 w-3" />
                    Capture All
                  </Button>
                )}
                {availableCaptures.map((minutes) => (
                  <Button
                    key={minutes}
                    size="sm"
                    variant="outline"
                    onClick={() => captureLastMinutes(minutes)}
                    className="text-xs"
                  >
                    <Clock className="mr-1 h-3 w-3" />
                    {minutes}min
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={clearBuffer} className="text-xs">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settings Panel */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Recording Settings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="source" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="source">Source</TabsTrigger>
                  <TabsTrigger value="audio">Audio</TabsTrigger>
                  <TabsTrigger value="quality">Quality</TabsTrigger>
                </TabsList>

                <TabsContent value="source" className="space-y-4">
                  <div className="space-y-3">
                    <Label>Screen Source</Label>
                    <div className="grid grid-cols-1 gap-2">
                      <Button
                        variant={settings.screenSource === "screen" ? "default" : "outline"}
                        className="justify-start"
                        onClick={() => updateSettings("screenSource", "screen")}
                        disabled={recording || backgroundRecording}
                      >
                        <Monitor className="mr-2 h-4 w-4" />
                        Entire Screen
                      </Button>
                      <Button
                        variant={settings.screenSource === "window" ? "default" : "outline"}
                        className="justify-start"
                        onClick={() => updateSettings("screenSource", "window")}
                        disabled={recording || backgroundRecording}
                      >
                        <Window className="mr-2 h-4 w-4" />
                        Application Window
                      </Button>
                      <Button
                        variant={settings.screenSource === "tab" ? "default" : "outline"}
                        className="justify-start"
                        onClick={() => updateSettings("screenSource", "tab")}
                        disabled={recording || backgroundRecording}
                      >
                        <Chrome className="mr-2 h-4 w-4" />
                        Browser Tab
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <RotateCcw className="h-4 w-4" />
                        <Label>Background Recording</Label>
                      </div>
                      <Switch
                        checked={backgroundRecording}
                        onCheckedChange={async (checked) => {
                          console.log(`Switch toggled: ${checked}`)
                          try {
                            if (checked) {
                              await startBackgroundRecording()
                            } else {
                              stopBackgroundRecording()
                            }
                          } catch (err) {
                            console.error("Switch error:", err)
                            setError(`Failed to ${checked ? "start" : "stop"} background recording`)
                          }
                        }}
                        disabled={recording}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Buffer Duration</Label>
                      <Select
                        value={settings.bufferDuration.toString()}
                        onValueChange={(value) => updateSettings("bufferDuration", Number.parseInt(value))}
                        disabled={recording}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 minute</SelectItem>
                          <SelectItem value="3">3 minutes</SelectItem>
                          <SelectItem value="5">5 minutes</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Background recording continuously captures your screen. Use capture buttons to save recordings.
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="audio" className="space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {settings.includeSystemAudio ? (
                          <Volume2 className="h-4 w-4" />
                        ) : (
                          <VolumeX className="h-4 w-4" />
                        )}
                        <Label>System Audio</Label>
                      </div>
                      <Switch
                        checked={settings.includeSystemAudio}
                        onCheckedChange={(checked) => updateSettings("includeSystemAudio", checked)}
                        disabled={recording || backgroundRecording}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {settings.includeMicrophone ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                        <Label>Microphone</Label>
                      </div>
                      <Switch
                        checked={settings.includeMicrophone}
                        onCheckedChange={(checked) => updateSettings("includeMicrophone", checked)}
                        disabled={recording || backgroundRecording}
                      />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <Label>Audio Bitrate: {settings.audioBitrate} kbps</Label>
                      <Slider
                        value={[settings.audioBitrate]}
                        onValueChange={([value]) => updateSettings("audioBitrate", value)}
                        min={64}
                        max={320}
                        step={32}
                        disabled={recording || backgroundRecording}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="quality" className="space-y-4">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Video Quality</Label>
                      <Select
                        value={settings.videoQuality}
                        onValueChange={(value: any) => updateSettings("videoQuality", value)}
                        disabled={recording || backgroundRecording}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low (720p)</SelectItem>
                          <SelectItem value="medium">Medium (1080p)</SelectItem>
                          <SelectItem value="high">High (1440p)</SelectItem>
                          <SelectItem value="ultra">Ultra (4K)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Frame Rate: {settings.frameRate} fps</Label>
                      <Slider
                        value={[settings.frameRate]}
                        onValueChange={([value]) => updateSettings("frameRate", value)}
                        min={15}
                        max={60}
                        step={15}
                        disabled={recording || backgroundRecording}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Main Recording Area */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video className="h-5 w-5" />
                Screen Recorder
                {recording && (
                  <Badge variant="destructive" className="ml-auto">
                    <Radio className="mr-1 h-3 w-3" />
                    LIVE
                  </Badge>
                )}
                {backgroundRecording && (
                  <Badge variant="secondary" className="ml-auto">
                    <Clock className="mr-1 h-3 w-3" />
                    BUFFER
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {videoURL ? (
                <div className="relative aspect-video bg-black rounded-md overflow-hidden">
                  <video ref={videoRef} src={videoURL} controls className="w-full h-full" />
                </div>
              ) : (
                <div className="relative aspect-video bg-muted flex items-center justify-center rounded-md border-2 border-dashed">
                  <div className="text-center">
                    {recording ? (
                      <div className="flex flex-col items-center gap-4">
                        <div className="relative">
                          <div className="h-16 w-16 rounded-full bg-red-500/20 flex items-center justify-center">
                            <div className="h-8 w-8 rounded-full bg-red-500 animate-pulse"></div>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-lg font-medium">
                            {paused ? "Recording paused" : "Recording in progress..."}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {settings.screenSource} • {settings.videoQuality} quality
                          </p>
                        </div>
                      </div>
                    ) : backgroundRecording ? (
                      <div className="flex flex-col items-center gap-4">
                        <div className="relative">
                          <div className="h-16 w-16 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <Clock className="h-8 w-8 text-blue-500" />
                          </div>
                          <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-blue-500 animate-pulse"></div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-lg font-medium">Background Recording Active</p>
                          <p className="text-sm text-muted-foreground">
                            {formatTime(bufferTime)} • {bufferSize} chunks • {availableCaptures.length} captures
                            available
                          </p>
                        </div>
                        {bufferSize > 0 && (
                          <div className="flex justify-center gap-2 mt-2">
                            <Button size="sm" onClick={() => captureLastMinutes(null)}>
                              <Save className="mr-1 h-3 w-3" />
                              Capture Now
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-4">
                        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                          <Video className="h-8 w-8 text-primary" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-lg font-medium">Ready to Record</p>
                          <p className="text-sm text-muted-foreground">
                            Start manual recording or enable background recording
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Control Buttons */}
              <div className="flex flex-wrap gap-2 mt-4">
                {!recording && !backgroundRecording && (
                  <Button onClick={startRecording} className="flex-1" size="lg">
                    <Play className="mr-2 h-4 w-4" />
                    Start Recording
                  </Button>
                )}

                {!recording && backgroundRecording && (
                  <Button onClick={startRecording} className="flex-1" size="lg">
                    <Play className="mr-2 h-4 w-4" />
                    Start Manual Recording
                  </Button>
                )}

                {recording && !paused && (
                  <>
                    <Button onClick={pauseRecording} variant="outline" className="flex-1">
                      <Pause className="mr-2 h-4 w-4" />
                      Pause
                    </Button>
                    <Button onClick={stopRecording} variant="destructive" className="flex-1">
                      <Square className="mr-2 h-4 w-4" />
                      Stop
                    </Button>
                  </>
                )}

                {recording && paused && (
                  <>
                    <Button onClick={resumeRecording} variant="outline" className="flex-1">
                      <Play className="mr-2 h-4 w-4" />
                      Resume
                    </Button>
                    <Button onClick={stopRecording} variant="destructive" className="flex-1">
                      <Square className="mr-2 h-4 w-4" />
                      Stop
                    </Button>
                  </>
                )}

                {videoURL && (
                  <>
                    <Button onClick={startRecording} variant="outline" className="flex-1">
                      <Play className="mr-2 h-4 w-4" />
                      New Recording
                    </Button>
                    <Button onClick={downloadRecording} className="flex-1">
                      <Download className="mr-2 h-4 w-4" />
                      Download Recording
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
