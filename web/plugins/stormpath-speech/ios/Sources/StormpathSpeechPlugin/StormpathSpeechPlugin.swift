import Foundation
import AVFoundation
import Capacitor

/**
 * Advisory / one-shot TTS. Turn-by-turn stays on Mapbox RouteVoiceController.
 * Does not cancel Mapbox speech — callers should skip when a turn is likely speaking.
 */
@objc(StormpathSpeechPlugin)
public class StormpathSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StormpathSpeechPlugin"
    public let jsName = "StormpathSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSpeaking", returnType: CAPPluginReturnPromise),
    ]

    private let synthesizer = AVSpeechSynthesizer()

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else {
            call.reject("text required")
            return
        }
        let interrupt = call.getBool("interrupt") ?? false
        let rate = Float(call.getDouble("rate") ?? 0.5)

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
            try session.setActive(true, options: [])
        } catch {
            /* Still try to speak if session setup fails. */
        }

        if interrupt && synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        } else if synthesizer.isSpeaking {
            call.resolve(["spoke": false, "reason": "busy"])
            return
        }

        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, rate))
        utterance.volume = 1.0
        if let voice = AVSpeechSynthesisVoice(language: "en-US") {
            utterance.voice = voice
        }
        synthesizer.speak(utterance)
        call.resolve(["spoke": true])
    }

    @objc func stop(_ call: CAPPluginCall) {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        call.resolve()
    }

    @objc func isSpeaking(_ call: CAPPluginCall) {
        call.resolve(["speaking": synthesizer.isSpeaking])
    }
}
