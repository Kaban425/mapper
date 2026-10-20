"use strict";

const { listen } = window.__TAURI__.event;

const hud = document.getElementById("hud");
const title = document.getElementById("hud-title");
const lines = document.getElementById("hud-lines");

listen("hud-update", (event) => {
  const { title: text, lines: rows, tone } = event.payload;
  hud.classList.toggle("warn", tone === "warn");
  title.textContent = text;
  lines.replaceChildren(
    ...rows.map((row) => {
      const div = document.createElement("div");
      div.textContent = row;
      return div;
    }),
  );
});
