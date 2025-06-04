"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Download, Pause, Play, Square, Video } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"

export default function ScreenRecorder() {
  const [recording, setRecording] = useState<boolean>(false)
  const [paused, setPaused] = useState<boolean>(false)
  const [videoURL, setVideoURL] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const { toast } = useToast()

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && recording) {
        mediaRecorderRef.current.stop()
      }
      if (videoURL) {
        URL.revokeObjectURL(videoURL)
      }
    }
  }, [recording, videoURL])

  const startRecording = async () => {
    setError(null)
    chunksRef.current = []
    setVideoURL(null)

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: true,
      })

      const mediaRecorder = new MediaRecorder(stream)
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

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop())

        toast({
          title: "Recording completed",
          description: "Your screen recording is ready to download.",
        })
      }

      mediaRecorder.onerror = (event) => {
        setError("Recording error occurred")
        setRecording(false)
        setPaused(false)
      }

      mediaRecorder.start(200) // Collect data every 200ms
      setRecording(true)

      toast({
        title: "Recording started",
        description: "Your screen is now being recorded.",
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

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-5 w-5" />
          Screen Recorder
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
          <div className="relative aspect-video bg-muted flex items-center justify-center rounded-md">
            <div className="text-center">
              {recording ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-red-500 animate-pulse"></div>
                  <p className="text-sm font-medium">{paused ? "Recording paused" : "Recording in progress..."}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Video className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click &quot;Start Recording&quot; to begin</p>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {!recording && !videoURL && (
          <Button onClick={startRecording} className="flex-1">
            <Play className="mr-2 h-4 w-4" />
            Start Recording
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
              Download
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  )
}
