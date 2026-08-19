"use client";

import { useEffect, useRef, useState, type SVGProps } from "react";
import { transcribeVoice } from "@/lib/voice/actions";
import { cn } from "@/lib/cn";
import { useLocale } from "@/lib/i18n/provider";

const MAX_RECORDING_MS = 30_000;

type Status = "idle" | "recording" | "transcribing" | "error";

function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}

export function VoiceRecorderButton({
  onTranscript,
  disabled,
  size = "md",
  className,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useLocale();
  const v = t.voice;
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function startRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError(v.noMic);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void handleStop();

      recorderRef.current = recorder;
      recorder.start();
      setStatus("recording");

      timeoutRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch {
      setStatus("error");
      setError(v.micBlocked);
    }
  }

  function stopRecording() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function handleStop() {
    setStatus("transcribing");
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" });
    chunksRef.current = [];

    if (blob.size === 0) {
      setStatus("idle");
      return;
    }

    const formData = new FormData();
    formData.set("audio", blob, "voice.webm");

    const result = await transcribeVoice(formData);

    if (result.error !== null) {
      setStatus("error");
      setError(result.error);
      return;
    }

    setStatus("idle");
    onTranscript(result.text);
  }

  function handleClick() {
    if (status === "recording") {
      stopRecording();
    } else if (status === "idle" || status === "error") {
      startRecording();
    }
  }

  const dim = size === "sm" ? "h-7 w-7" : "h-9 w-9";

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || status === "transcribing"}
        aria-label={status === "recording" ? v.stopRecording : v.speak}
        title={status === "recording" ? v.stopRecording : v.speak}
        className={cn(
          "flex flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
          dim,
          status === "recording"
            ? "animate-pulse bg-red-500 text-white"
            : "bg-atelier-ink/5 text-atelier-muted hover:bg-atelier-ink/10 hover:text-atelier-ink",
          className,
        )}
      >
        <MicIcon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>
      {status === "transcribing" && (
        <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-atelier-muted">
          {v.transcribing}
        </span>
      )}
      {status === "error" && error && (
        <span className="absolute -bottom-5 left-1/2 w-40 -translate-x-1/2 whitespace-normal text-center text-[10px] text-red-500">
          {error}
        </span>
      )}
    </div>
  );
}
