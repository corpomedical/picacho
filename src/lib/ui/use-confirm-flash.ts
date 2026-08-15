"use client";

import { useEffect, useRef, useState } from "react";

// Turns a sticky "saved" flag into a brief flash.
//
// Several forms keep status === "saved" indefinitely — deliberately, because
// they also show a lasting note ("check your inbox to confirm the change").
// Driving the button's green confirmation straight off that flag would leave
// it green until the next edit, which stops reading as "that just worked" and
// starts reading as a stuck button. This watches for the moment the flag
// turns true and returns true only for `ms` afterwards.
export function useConfirmFlash(done: boolean, ms = 1100): boolean {
  const [flash, setFlash] = useState(false);
  const previous = useRef(done);

  useEffect(() => {
    const rose = done && !previous.current;
    previous.current = done;
    if (!rose) return;

    setFlash(true);
    const id = setTimeout(() => setFlash(false), ms);
    return () => clearTimeout(id);
  }, [done, ms]);

  return flash;
}
