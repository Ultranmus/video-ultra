import AVFoundation
import Foundation

// Speech with known word times, for measuring caption timing (DECISIONS #165): the system voice
// for <language> speaks <text> into <out.caf> and prints "word<TAB>start" per word (seconds),
// from the synthesiser itself (checked against the voice onsets: within ~0.1 s). macOS only.
// Built and run by scripts/captions-timing.ts.
// Usage: tts-words <language, e.g. en-GB> <text> <out.caf>
let args = CommandLine.arguments
let synth = AVSpeechSynthesizer()
final class Delegate: NSObject, AVSpeechSynthesizerDelegate {
  var framesSoFar: AVAudioFramePosition = 0
  var sampleRate: Double = 22050
  var marks: [(String, Double)] = []
  let text: NSString
  init(text: String) { self.text = text as NSString }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeakRangeOfSpeechString r: NSRange, utterance: AVSpeechUtterance) {
    marks.append((text.substring(with: r), Double(framesSoFar) / sampleRate))
  }
}
let utterance = AVSpeechUtterance(string: args[2])
utterance.voice = AVSpeechSynthesisVoice(language: args[1])
let delegate = Delegate(text: args[2])
synth.delegate = delegate
var file: AVAudioFile?
let done = DispatchSemaphore(value: 0)
synth.write(utterance) { buffer in
  guard let pcm = buffer as? AVAudioPCMBuffer else { return }
  if pcm.frameLength == 0 { done.signal(); return }
  if file == nil {
    delegate.sampleRate = pcm.format.sampleRate
    file = try! AVAudioFile(forWriting: URL(fileURLWithPath: args[3]), settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
  }
  try! file!.write(from: pcm)
  delegate.framesSoFar += AVAudioFramePosition(pcm.frameLength)
}
while done.wait(timeout: .now() + 0.05) == .timedOut { RunLoop.current.run(until: Date() + 0.05) }
for (w, t) in delegate.marks { print("\(w)\t\(String(format: "%.3f", t))") }
