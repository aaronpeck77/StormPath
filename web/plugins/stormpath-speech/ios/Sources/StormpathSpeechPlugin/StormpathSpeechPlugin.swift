import Foundation
import AVFoundation
import Speech
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
        CAPPluginMethod(name: "listen", returnType: CAPPluginReturnPromise),
    ]

    private let synthesizer = AVSpeechSynthesizer()

    /// The English voice the driver picked in iPhone Settings. StormPath does not choose one for them.
    private func stormyVoice() -> AVSpeechSynthesisVoice? {
        AVSpeechSynthesisVoice(language: "en-US")
    }

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
        let voice = stormyVoice()
        let natural: Bool
        if let voice {
            utterance.voice = voice
            let id = voice.identifier.lowercased()
            if #available(iOS 16.0, *) {
                natural = voice.quality == .premium || voice.quality == .enhanced || id.contains("premium") || id.contains("enhanced")
            } else {
                natural = voice.quality == .enhanced || id.contains("premium") || id.contains("enhanced")
            }
        } else {
            natural = false
        }
        let paced = natural ? min(rate, Float(0.48)) : min(rate, Float(0.42))
        utterance.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, paced))
        utterance.pitchMultiplier = natural ? 1.0 : 1.03
        utterance.volume = 1.0
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

    /// One remark, recognized on the phone. The microphone is not streamed.
    /// Resolve the call before stopping the engine. Stopping on the main thread
    /// deadlocks the audio tap and leaves the button on Listening.
    @objc func listen(_ call: CAPPluginCall) {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            ensureMicThenListen(call)
        case .denied, .restricted:
            call.reject("speech recognition denied")
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async {
                    guard status == .authorized else {
                        call.reject("speech recognition denied")
                        return
                    }
                    self.ensureMicThenListen(call)
                }
            }
        @unknown default:
            call.reject("speech recognition unavailable")
        }
    }

    private func ensureMicThenListen(_ call: CAPPluginCall) {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            startOnDeviceListen(call)
        case .denied:
            call.reject("microphone denied")
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        call.reject("microphone denied")
                        return
                    }
                    self.startOnDeviceListen(call)
                }
            }
        @unknown default:
            call.reject("microphone unavailable")
        }
    }

    private func startOnDeviceListen(_ call: CAPPluginCall) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.isAvailable else {
            call.reject("speech recognition unavailable")
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        // Keyboard dictation (the search mic) uses Apple's dictation service.
        // Forcing the small on-device model is what missed place names on iPhone 12 and 15.
        request.requiresOnDeviceRecognition = false
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        if #available(iOS 16.0, *) {
            request.addsPunctuation = true
        }

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try session.setActive(true)
        } catch {
            call.reject("microphone unavailable")
            return
        }

        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            call.reject("microphone unavailable")
            return
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            call.reject("microphone unavailable")
            return
        }

        let teardown = DispatchQueue(label: "stormpath.speech.listen")
        var finished = false
        var latest = ""
        func finish(_ text: String) {
            if finished { return }
            finished = true
            call.resolve(["text": text])
            teardown.async {
                input.removeTap(onBus: 0)
                engine.stop()
                request.endAudio()
            }
        }

        let started = Date()
        var lastHeard = started
        recognizer.recognitionTask(with: request) { result, _ in
            let text = result?.bestTranscription.formattedString ?? ""
            let isFinal = result?.isFinal == true
            DispatchQueue.main.async {
                if !text.isEmpty && text != latest {
                    latest = text
                    lastHeard = Date()
                }
                if isFinal && !latest.isEmpty { finish(latest) }
            }
        }
        func waitForPause() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                if finished { return }
                if !latest.isEmpty && Date().timeIntervalSince(lastHeard) > 1.15 {
                    finish(latest)
                    return
                }
                if Date().timeIntervalSince(started) > 11 {
                    finish(latest)
                    return
                }
                waitForPause()
            }
        }
        waitForPause()
    }
}
