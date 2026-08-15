import Foundation
import Capacitor
import UIKit
import CoreHaptics

@objc(VelarisHapticsPlugin)
public class VelarisHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VelarisHapticsPlugin"
    public let jsName = "VelarisHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "emotionalPulse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "kissMoment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mismatchAlert", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "outreachTap", returnType: CAPPluginReturnPromise),
    ]
    
    private var engine: CHHapticEngine?
    
    override public func load() {
        prepareHapticEngine()
    }
    
    private func prepareHapticEngine() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        do {
            engine = try CHHapticEngine()
            engine?.resetHandler = { [weak self] in
                try? self?.engine?.start()
            }
            try engine?.start()
        } catch {
            print("Velaris Haptics: Engine failed to start - \(error)")
        }
    }
    
    // ── Emotional Pulse ──
    // Maps emotional dimensions to distinct haptic patterns
    @objc func emotionalPulse(_ call: CAPPluginCall) {
        let dimension = call.getString("dimension") ?? "warmth"
        let intensity = call.getFloat("intensity") ?? 0.5
        
        switch dimension.lowercased() {
        case "warmth":
            // Slow, gentle rolling pulse — like being held
            playPattern(events: [
                makeEvent(intensity: Double(intensity) * 0.4, sharpness: 0.2, time: 0.0, duration: 0.3),
                makeEvent(intensity: Double(intensity) * 0.6, sharpness: 0.15, time: 0.15, duration: 0.3),
                makeEvent(intensity: Double(intensity) * 0.5, sharpness: 0.1, time: 0.35, duration: 0.2),
            ])
            
        case "tension":
            // Quick, sharp — like a flinch
            playPattern(events: [
                makeEvent(intensity: Double(intensity) * 0.8, sharpness: 0.9, time: 0.0, duration: 0.05),
            ])
            
        case "connection":
            // Sustained gentle vibration — presence
            playPattern(events: [
                makeEvent(intensity: Double(intensity) * 0.35, sharpness: 0.15, time: 0.0, duration: 0.5),
            ])
            
        case "curiosity":
            // Light playful double-tap
            playPattern(events: [
                makeEvent(intensity: Double(intensity) * 0.4, sharpness: 0.5, time: 0.0, duration: 0.08),
                makeEvent(intensity: Double(intensity) * 0.5, sharpness: 0.6, time: 0.15, duration: 0.08),
            ])
            
        case "desire":
            // Deep slow pulse
            playPattern(events: [
                makeEvent(intensity: Double(intensity) * 0.6, sharpness: 0.1, time: 0.0, duration: 0.4),
                makeEvent(intensity: Double(intensity) * 0.3, sharpness: 0.05, time: 0.3, duration: 0.3),
            ])
            
        default:
            // Generic medium tap
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred(intensity: CGFloat(intensity))
        }
        
        call.resolve()
    }
    
    // ── Kiss Moment ──
    // Three gentle ascending pulses — the threshold crossing
    @objc func kissMoment(_ call: CAPPluginCall) {
        playPattern(events: [
            makeEvent(intensity: 0.3, sharpness: 0.1, time: 0.0, duration: 0.2),
            makeEvent(intensity: 0.4, sharpness: 0.15, time: 0.25, duration: 0.2),
            makeEvent(intensity: 0.5, sharpness: 0.2, time: 0.5, duration: 0.3),
        ])
        call.resolve()
    }
    
    // ── Relational Mismatch Alert ──
    // Single heavy dissonant tap — she predicted wrong
    @objc func mismatchAlert(_ call: CAPPluginCall) {
        playPattern(events: [
            makeEvent(intensity: 0.8, sharpness: 0.9, time: 0.0, duration: 0.1),
            makeEvent(intensity: 0.3, sharpness: 0.3, time: 0.15, duration: 0.15),
        ])
        call.resolve()
    }
    
    // ── Outreach Tap ──
    // Soft double-tap — she's reaching out
    @objc func outreachTap(_ call: CAPPluginCall) {
        playPattern(events: [
            makeEvent(intensity: 0.4, sharpness: 0.3, time: 0.0, duration: 0.1),
            makeEvent(intensity: 0.35, sharpness: 0.25, time: 0.2, duration: 0.1),
        ])
        call.resolve()
    }
    
    // ── Helpers ──
    private func makeEvent(intensity: Double, sharpness: Double, time: Double, duration: Double) -> CHHapticEvent {
        let params = [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(intensity)),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: Float(sharpness)),
        ]
        return CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: params,
            relativeTime: time,
            duration: duration
        )
    }
    
    private func playPattern(events: [CHHapticEvent]) {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics,
              let engine = engine else {
            // Fallback to basic haptics
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()
            return
        }
        
        do {
            let pattern = try CHHapticPattern(events: events, parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            print("Velaris Haptics: Pattern failed - \(error)")
        }
    }
}
