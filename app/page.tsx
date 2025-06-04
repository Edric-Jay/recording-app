import AdvancedScreenRecorder from "@/components/advanced-screen-recorder"

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="w-full max-w-5xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Advanced Screen Recorder
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            Professional screen recording with advanced audio and source selection
          </p>
        </div>
        <AdvancedScreenRecorder />
      </div>
    </main>
  )
}
