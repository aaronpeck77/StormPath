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

    /// One remark, recognized on the phone. The microphone is not streamed.
    @objc func listen(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    call.reject("speech recognition denied")
                    return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        guard granted else {
                            call.reject("microphone denied")
                            return
                        }
                        self.startOnDeviceListen(call)
                    }
                }
            }
        }
    }

    private func startOnDeviceListen(_ call: CAPPluginCall) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.isAvailable else {
            call.reject("speech recognition unavailable")
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request.shouldReportPartialResults = true

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

        var finished = false
        var latest = ""
        func finish(_ text: String) {
            if finished { return }
            finished = true
            engine.stop()
            input.removeTap(onBus: 0)
            request.endAudio()
            call.resolve(["text": text])
        }

        recognizer.recognitionTask(with: request) { result, error in
            if let text = result?.bestTranscription.formattedString {
                latest = text
                if result?.isFinal == true {
                    DispatchQueue.main.async { finish(text) }
                    return
                }
            }
            if error != nil {
                DispatchQueue.main.async { finish(latest) }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
            engine.stop()
            request.endAudio()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 9) {
            finish(latest)
        }
    }
}
