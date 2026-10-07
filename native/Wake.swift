import Foundation
import IOKit.pwr_mgt

@objc protocol WakeService {
    func sync(_ timestamp: String, withReply reply: @escaping (String) -> Void)
    func status(withReply reply: @escaping (String) -> Void)
}
let serviceName = "com.localscheduler.wake"

final class WakeSession: NSObject, WakeService {
    let uid: uid_t
    init(uid: uid_t) { self.uid = uid }
    func status(withReply reply: @escaping (String) -> Void) { reply("ok") }
    func sync(_ timestamp: String, withReply reply: @escaping (String) -> Void) {
        guard uid > 0 else { reply("Usuário inválido"); return }
        let owner = "com.localscheduler.wake.\(uid)" as CFString
        var date: Date? = nil
        if !timestamp.isEmpty {
            guard let seconds = Double(timestamp), seconds.isFinite else { reply("Data inválida"); return }
            let candidate = Date(timeIntervalSince1970: seconds)
            guard candidate.timeIntervalSinceNow > 0, candidate.timeIntervalSinceNow < 366 * 86400 else { reply("Data fora do intervalo permitido"); return }
            date = candidate
        }
        if let events = IOPMCopyScheduledPowerEvents()?.takeRetainedValue() as? [[String: Any]] {
            for event in events where event["scheduledby"] as? String == owner as String {
                if let oldDate = event["time"] as? Date, let type = event["eventtype"] as? String {
                    if let date, abs(oldDate.timeIntervalSince(date)) < 1 { reply("ok"); return }
                    let result = IOPMCancelScheduledPowerEvent(oldDate as CFDate, owner, type as CFString)
                    if result != kIOReturnSuccess { reply("Falha ao cancelar despertar: \(result)"); return }
                }
            }
        }
        if let date {
            let result = IOPMSchedulePowerEvent(date as CFDate, owner, kIOPMAutoWake as CFString)
            if result != kIOReturnSuccess { reply("Falha ao programar despertar: \(result)"); return }
        }
        reply("ok")
    }
}
final class Delegate: NSObject, NSXPCListenerDelegate {
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        guard connection.effectiveUserIdentifier > 0 else { return false }
        connection.exportedInterface = NSXPCInterface(with: WakeService.self)
        connection.exportedObject = WakeSession(uid: connection.effectiveUserIdentifier)
        connection.resume()
        return true
    }
}
if CommandLine.arguments.contains("daemon") {
    let delegate = Delegate()
    let listener = NSXPCListener(machServiceName: serviceName)
    listener.delegate = delegate
    listener.resume()
    RunLoop.current.run()
} else {
    let connection = NSXPCConnection(machServiceName: serviceName, options: .privileged)
    connection.remoteObjectInterface = NSXPCInterface(with: WakeService.self)
    connection.resume()
    let callback: (String) -> Void = { result in print(result); exit(result == "ok" ? 0 : 1) }
    let proxy = connection.remoteObjectProxyWithErrorHandler { error in print("Serviço de despertar não disponível: \(error.localizedDescription)"); exit(1) } as! WakeService
    if CommandLine.arguments.count > 2 && CommandLine.arguments[1] == "sync" { proxy.sync(CommandLine.arguments[2], withReply: callback) }
    else { proxy.status(withReply: callback) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { print("Serviço de despertar não respondeu"); exit(1) }
    RunLoop.current.run()
}
