import Foundation
import Photos
import UIKit
import Capacitor

// PicachoMedia: Download in the iPhone app saves to Photos (the iOS half of
// src/lib/native/save-media.ts).
//
// A web view on iOS has no downloads at all: an <a download> just opens the
// file in place of the page. The Android shell writes into the phone's shared
// Pictures and Movies folders; iOS has no such folders, and the one place a
// person looks for a saved picture or video is the Photos library. So:
//
// - a picture goes into Photos as it is (PNG, JPEG, GIF, HEIC) or, for a
//   format Photos doesn't take as a file (WebP, AVIF), as a PNG of it;
// - a video goes into Photos when iOS can play it there (MP4, MOV);
// - anything else (a WebM, a PDF, a 3D model, a document) opens the share
//   sheet on the real file, whose "Save to Files" is where iOS keeps those.
//
// Photos asks once, for adding only (NSPhotoLibraryAddUsageDescription): the
// app never reads the library. A "no" rejects with PHOTOS_DENIED, which the
// site turns into "allow Picacho to add to Photos in Settings".
//
// `url` is either a web address, fetched here (media URLs are capability
// links, lib/media/url.ts, and Capacitor copies the web view's cookies into
// the shared cookie store for anything else), or a file:// address the page
// wrote with the Filesystem plugin (a blob: or data: link it made itself).
// That file is the page's to delete; a file downloaded here is deleted here.
@objc(MediaPlugin)
public class MediaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MediaPlugin"
    public let jsName = "PicachoMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    @objc func save(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              url.isFileURL || url.scheme == "https" || url.scheme == "http" else {
            call.reject("Nothing to save", "BAD_URL")
            return
        }
        let kind = call.getString("kind") ?? "file"
        let name = MediaPlugin.safeName(call.getString("name") ?? url.lastPathComponent)

        if url.isFileURL {
            store(url, name: name, kind: kind, ownsFile: false, call: call)
            return
        }

        let task = URLSession.shared.downloadTask(with: url) { [weak self] location, response, error in
            guard let self = self else { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard error == nil, let location = location, (200..<300).contains(status) else {
                call.reject("Couldn't download the file", "DOWNLOAD_FAILED", error)
                return
            }
            do {
                // The system deletes `location` when this block returns, and
                // Photos and the share sheet both read the file later, under
                // its real name (Photos goes by the extension for a video).
                let folder = FileManager.default.temporaryDirectory
                    .appendingPathComponent("picacho-save", isDirectory: true)
                    .appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let file = folder.appendingPathComponent(name)
                try FileManager.default.moveItem(at: location, to: file)
                self.store(file, name: name, kind: kind, ownsFile: true, call: call)
            } catch {
                call.reject("Couldn't keep the downloaded file", "DOWNLOAD_FAILED", error)
            }
        }
        task.resume()
    }

    // MARK: - Where it goes

    private func store(_ file: URL, name: String, kind: String, ownsFile: Bool, call: CAPPluginCall) {
        let done = { [weak self] in
            if ownsFile { self?.remove(file) }
        }

        if kind == "image", let data = try? Data(contentsOf: file) {
            let photo: Data?
            var photoName = name
            if MediaPlugin.photosTakesAsIs(data) {
                photo = data
            } else {
                photo = UIImage(data: data)?.pngData()
                photoName = (name as NSString).deletingPathExtension + ".png"
            }
            if let photo = photo {
                addToPhotos(call: call, then: done) { request, options in
                    options.originalFilename = photoName
                    request.addResource(with: .photo, data: photo, options: options)
                }
                return
            }
        }

        if kind == "video", UIVideoAtPathIsCompatibleWithSavedPhotosAlbum(file.path) {
            addToPhotos(call: call, then: done) { request, options in
                options.originalFilename = name
                request.addResource(with: .video, fileURL: file, options: options)
            }
            return
        }

        share(file, call: call, then: done)
    }

    private func addToPhotos(call: CAPPluginCall,
                             then done: @escaping () -> Void,
                             _ build: @escaping (PHAssetCreationRequest, PHAssetResourceCreationOptions) -> Void) {
        MediaPlugin.withAddAccess { granted in
            guard granted else {
                done()
                call.reject("Picacho isn't allowed to add to Photos", "PHOTOS_DENIED")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                build(PHAssetCreationRequest.forAsset(), PHAssetResourceCreationOptions())
            }, completionHandler: { ok, error in
                done()
                if ok {
                    call.resolve(["savedTo": "photos"])
                } else {
                    call.reject("Photos didn't take the file", "SAVE_FAILED", error)
                }
            })
        }
    }

    private func share(_ file: URL, call: CAPPluginCall, then done: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let host = self?.bridge?.viewController else {
                done()
                call.reject("Nothing to show the share sheet on", "SAVE_FAILED")
                return
            }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            sheet.completionWithItemsHandler = { _, completed, _, error in
                done()
                if let error = error {
                    call.reject("The share sheet failed", "SAVE_FAILED", error)
                } else {
                    call.resolve(["savedTo": completed ? "shared" : "cancelled"])
                }
            }
            // On iPad the sheet is a popover and must be anchored, or UIKit
            // throws.
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = host.view
                popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            host.present(sheet, animated: true)
        }
    }

    // MARK: - Helpers

    private func remove(_ file: URL) {
        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }

    private static func withAddAccess(_ answer: @escaping (Bool) -> Void) {
        switch PHPhotoLibrary.authorizationStatus(for: .addOnly) {
        case .authorized, .limited:
            answer(true)
        case .notDetermined:
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                answer(status == .authorized || status == .limited)
            }
        default:
            answer(false)
        }
    }

    // PNG, JPEG, GIF and HEIC/HEIF go into Photos as they are; anything else
    // is re-encoded.
    private static func photosTakesAsIs(_ data: Data) -> Bool {
        let b = [UInt8](data.prefix(12))
        if b.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return true }
        if b.starts(with: [0xFF, 0xD8, 0xFF]) { return true }
        if b.starts(with: [0x47, 0x49, 0x46, 0x38]) { return true }
        if b.count == 12, b[4] == 0x66, b[5] == 0x74, b[6] == 0x79, b[7] == 0x70 {
            let brand = String(bytes: b[8..<12], encoding: .ascii) ?? ""
            return ["heic", "heix", "hevc", "mif1", "msf1"].contains(brand)
        }
        return false
    }

    // A file name that is safe on disk and keeps its extension.
    private static func safeName(_ requested: String) -> String {
        let banned = CharacterSet(charactersIn: "/\\:?%*|\"<>").union(.controlCharacters)
        let cleaned = requested.components(separatedBy: banned).joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let name = cleaned.isEmpty ? "picacho-file" : cleaned
        return String(name.suffix(120))
    }
}
