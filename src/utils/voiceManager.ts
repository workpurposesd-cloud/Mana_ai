import { VoiceLanguage, VoiceSettings } from '../types/chat'

// Define SpeechRecognition interface for browsers
interface IWindow extends Window {
  SpeechRecognition?: any
  webkitSpeechRecognition?: any
}

declare const window: IWindow

export const isSpeechRecognitionSupported = (): boolean => {
  if (typeof window === 'undefined') return false
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export const isSpeechSynthesisSupported = (): boolean => {
  if (typeof window === 'undefined') return false
  return 'speechSynthesis' in window
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voiceMode: false,
  language: 'en-US',
  rate: 1.0,
  pitch: 1.0,
  voiceURI: undefined,
}

export class VoiceManager {
  private recognition: any = null
  private isListeningState: boolean = false
  private isSpeakingState: boolean = false
  private currentUtterance: SpeechSynthesisUtterance | null = null

  // Get available voices from speech synthesis
  public getVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      if (!isSpeechSynthesisSupported()) {
        resolve([])
        return
      }

      let voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) {
        resolve(voices)
        return
      }

      const handler = () => {
        voices = window.speechSynthesis.getVoices()
        window.speechSynthesis.removeEventListener('voiceschanged', handler)
        resolve(voices)
      }

      window.speechSynthesis.addEventListener('voiceschanged', handler)
      // Fallback timeout in case voiceschanged does not fire
      setTimeout(() => {
        resolve(window.speechSynthesis.getVoices())
      }, 500)
    })
  }

  // Find best matching voice for selected language
  public async getBestVoiceForLanguage(lang: VoiceLanguage, preferredURI?: string): Promise<SpeechSynthesisVoice | null> {
    const voices = await this.getVoices()
    if (voices.length === 0) return null

    if (preferredURI) {
      const match = voices.find((v) => v.voiceURI === preferredURI)
      if (match) return match
    }

    // Normalize target language code prefix
    const langPrefix = lang.split('-')[0].toLowerCase()

    // 1. Exact match (e.g. "te-IN" or "hi-IN")
    const exact = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
    if (exact) return exact

    // 2. Prefix match (e.g. "te" or "hi")
    const prefixMatch = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix))
    if (prefixMatch) return prefixMatch

    // 3. Fallback to default or English
    const englishMatch = voices.find((v) => v.lang.toLowerCase().startsWith('en'))
    return englishMatch || voices[0] || null
  }

  // Start listening to microphone
  public startListening(options: {
    lang: VoiceLanguage
    onInterim: (text: string) => void
    onFinal: (text: string) => void
    onError: (errorMessage: string) => void
    onEnd: () => void
  }): boolean {
    if (!isSpeechRecognitionSupported()) {
      options.onError('Speech recognition is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Safari.')
      return false
    }

    // Crucial: Stop any speaking speech synthesis immediately so mic doesn't capture assistant's audio
    this.stopSpeaking()

    try {
      const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition
      this.recognition = new SpeechRecognitionClass()
      this.recognition.continuous = false
      this.recognition.interimResults = true
      this.recognition.lang = options.lang

      let finalTranscript = ''

      this.recognition.onstart = () => {
        this.isListeningState = true
      }

      this.recognition.onresult = (event: any) => {
        let interimTranscript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            finalTranscript += transcript
          } else {
            interimTranscript += transcript
          }
        }

        if (interimTranscript) {
          options.onInterim(interimTranscript)
        }
        if (finalTranscript) {
          options.onFinal(finalTranscript)
        }
      }

      this.recognition.onerror = (event: any) => {
        this.isListeningState = false
        let msg = 'Speech recognition encountered an issue.'

        switch (event.error) {
          case 'not-allowed':
          case 'service-not-allowed':
            msg = 'Microphone permission denied. Please click the camera/microphone icon in your browser address bar to allow access.'
            break
          case 'no-speech':
            msg = 'No speech detected. Click the microphone again and speak clearly.'
            break
          case 'network':
            msg = 'Speech recognition network error. Please check your internet connection.'
            break
          case 'audio-capture':
            msg = 'No microphone was found. Please ensure a microphone is connected.'
            break
          default:
            msg = `Speech recognition error: ${event.error}`
        }

        options.onError(msg)
      }

      this.recognition.onend = () => {
        this.isListeningState = false
        options.onEnd()
      }

      this.recognition.start()
      return true
    } catch (err: any) {
      this.isListeningState = false
      options.onError(err.message || 'Could not start speech recognition.')
      return false
    }
  }

  // Stop listening
  public stopListening(): void {
    if (this.recognition && this.isListeningState) {
      try {
        this.recognition.stop()
      } catch {
        // ignore
      }
    }
    this.isListeningState = false
  }

  // Speak text aloud using SpeechSynthesis
  public async speak(
    rawText: string,
    settings: VoiceSettings,
    callbacks?: {
      onStart?: () => void
      onEnd?: () => void
      onError?: (err: any) => void
    }
  ): Promise<void> {
    if (!isSpeechSynthesisSupported()) {
      callbacks?.onError?.('Speech synthesis is not supported in this browser.')
      return
    }

    // Cancel any current utterance
    this.stopSpeaking()

    // Make sure microphone is NOT listening while speaking to prevent echo loop
    this.stopListening()

    const cleanText = cleanTextForSpeech(rawText)
    if (!cleanText.trim()) {
      callbacks?.onEnd?.()
      return
    }

    try {
      const utterance = new SpeechSynthesisUtterance(cleanText)
      utterance.lang = settings.language
      utterance.rate = settings.rate || 1.0
      utterance.pitch = settings.pitch || 1.0

      const matchedVoice = await this.getBestVoiceForLanguage(settings.language, settings.voiceURI)
      if (matchedVoice) {
        utterance.voice = matchedVoice
      }

      utterance.onstart = () => {
        this.isSpeakingState = true
        callbacks?.onStart?.()
      }

      utterance.onend = () => {
        this.isSpeakingState = false
        this.currentUtterance = null
        callbacks?.onEnd?.()
      }

      utterance.onerror = (e) => {
        this.isSpeakingState = false
        this.currentUtterance = null
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          callbacks?.onError?.(e)
        } else {
          callbacks?.onEnd?.()
        }
      }

      this.currentUtterance = utterance
      window.speechSynthesis.speak(utterance)
    } catch (err) {
      this.isSpeakingState = false
      callbacks?.onError?.(err)
    }
  }

  // Stop speech playback
  public stopSpeaking(): void {
    if (isSpeechSynthesisSupported()) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        // ignore
      }
    }
    this.isSpeakingState = false
    this.currentUtterance = null
  }

  public isListening(): boolean {
    return this.isListeningState
  }

  public isSpeaking(): boolean {
    return isSpeechSynthesisSupported() ? window.speechSynthesis.speaking : false
  }
}

/**
 * Strips code blocks, URLs, markdown syntax, and emojis so voice pronunciation
 * sounds natural and fluent like a human friend.
 */
export function cleanTextForSpeech(markdown: string): string {
  if (!markdown) return ''

  let text = markdown

  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, 'Code block omitted.')

  // Remove inline code
  text = text.replace(/`([^`]+)`/g, '$1')

  // Remove markdown links but keep text: [Title](URL) -> Title
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // Remove image embeds: ![alt](url) -> ""
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '')

  // Remove bold/italic: **text** or *text* -> text
  text = text.replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')

  // Remove headings: # heading -> heading
  text = text.replace(/^#{1,6}\s+/gm, '')

  // Remove bullet points / lists
  text = text.replace(/^[-*•]\s+/gm, '')
  text = text.replace(/^\d+\.\s+/gm, '')

  // Remove URLs
  text = text.replace(/https?:\/\/[^\s]+/g, '')

  // Remove common emoji unicode sequences so it doesn't speak "waving hand sign"
  text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '')

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim()

  return text
}

export const voiceManager = new VoiceManager()
