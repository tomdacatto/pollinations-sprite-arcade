import { CODE_MODEL, IMAGE_MODEL, SPRITE_SIZE } from "./config.js";
import { buildPage, changeMessages, decodeShare, encodeShare, gameMessages, keyMagenta, parseGame } from "./forge.js";
import { appUrl, chat, clearSession, completeSignIn, drawImage, getSession, startSignIn } from "./pollen.js";

const $ = (selector) => document.querySelector(selector);
const seed = () => Math.floor(Math.random() * 1e9);
const state = { messages: [], sprites: [], images: {}, html: "", page: "", busy: false, fixed: false };
const BACKGROUND =
    ", game sprite on a perfectly flat solid pure magenta background (#FF00FF), centered, no shadow, no text";

function notice(message, kind = "info") {
    const box = $("#notice");
    box.hidden = !message;
    box.className = `notice ${kind === "error" ? "error" : ""}`;
    box.textContent = message ?? "";
}

function renderSession() {
    const session = getSession();
    $("#whoami").hidden = !session;
    $("#sign-out").hidden = !session;
    $("#sign-in").hidden = Boolean(session);
}

const PROBLEMS = {
    denied: "Sign-in was cancelled.",
    "bad-state": "That sign-in did not match this page. Try again.",
    "bad-key": "The sign-in returned something unexpected. Try again.",
    "no-storage": "This browser blocks the storage the sign-in needs.",
};

// ---- sprites: drawn on a magenta background, then cut out in code
async function makeSprite({ prompt }) {
    const blob = await drawImage(IMAGE_MODEL, prompt + BACKGROUND, {
        width: SPRITE_SIZE,
        height: SPRITE_SIZE,
        seed: seed(),
    });
    const bitmap = await createImageBitmap(blob);
    const canvas = Object.assign(document.createElement("canvas"), { width: SPRITE_SIZE, height: SPRITE_SIZE });
    const g = canvas.getContext("2d");
    g.drawImage(bitmap, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
    const frame = g.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    keyMagenta(frame.data);
    g.putImageData(frame, 0, 0);
    return canvas.toDataURL("image/webp", 0.85);
}

async function drawSprites(sprites) {
    const todo = sprites.filter((s) => !state.images[s.name]);
    let done = 0;
    const lanes = Array.from({ length: Math.min(2, todo.length) }, async () => {
        while (todo.length) {
            const sprite = todo.shift();
            $("#state").textContent = `Drawing sprite ${++done} of ${sprites.length}…`;
            state.images[sprite.name] = await makeSprite(sprite);
        }
    });
    await Promise.all(lanes);
}

// ---- the game
function play() {
    state.page = buildPage(state.html, state.images);
    state.fixed = false;
    $("#banner").hidden = true;
    $("#game").srcdoc = state.page;
    $("#stage").hidden = false;
    const strip = $("#sprites");
    strip.replaceChildren();
    for (const [name, url] of Object.entries(state.images)) {
        const img = Object.assign(new Image(), { src: url, alt: name, title: name, width: 48, height: 48 });
        strip.append(img);
    }
}

async function forge() {
    if (!getSession()) return startSignIn();
    if (state.busy) return;
    state.busy = true;
    $("#forge").disabled = true;
    notice(null);
    try {
        $("#state").textContent = "Writing the game…";
        const messages = gameMessages($("#idea").value.trim() || "a tiny arcade game");
        let reply = await chat(CODE_MODEL, messages, { seed: seed() });
        let parsed = parseGame(reply);
        let history = [...messages, { role: "assistant", content: reply }];
        if (parsed.error) {
            // One retry: tell the model what was wrong with its answer.
            $("#state").textContent = "Fixing the answer…";
            const asked = changeMessages(history, parsed.error);
            reply = await chat(CODE_MODEL, asked, { seed: seed() });
            history = [...asked, { role: "assistant", content: reply }];
            parsed = parseGame(reply, parsed.sprites);
        }
        if (parsed.error)
            return notice(`The model could not write a runnable game: ${parsed.error} Try again.`, "error");
        Object.assign(state, { messages: history, sprites: parsed.sprites, html: parsed.html, images: {} });
        await drawSprites(parsed.sprites);
        play();
    } catch (error) {
        notice(error.message, "error");
    } finally {
        $("#state").textContent = "";
        $("#forge").disabled = false;
        state.busy = false;
    }
}

async function change(request) {
    if (!getSession()) return startSignIn();
    if (state.busy || !state.html) return;
    state.busy = true;
    $("#apply").disabled = true;
    notice(null);
    try {
        const asked = changeMessages(state.messages, request);
        const reply = await chat(CODE_MODEL, asked, { seed: seed() });
        const parsed = parseGame(reply, state.sprites);
        if (parsed.error) return notice(`That change did not work: ${parsed.error} The game is unchanged.`, "error");
        Object.assign(state, { messages: [...asked, { role: "assistant", content: reply }], html: parsed.html });
        play();
    } catch (error) {
        notice(error.message, "error");
    } finally {
        $("#apply").disabled = false;
        state.busy = false;
    }
}

// A crash inside the sandboxed frame reaches us as a message; offer to have the model fix it, once.
addEventListener("message", (event) => {
    if (event.source !== $("#game").contentWindow || event.data?.kind !== "error" || state.fixed || !state.html) return;
    state.fixed = true;
    const banner = $("#banner");
    banner.hidden = false;
    banner.replaceChildren(`The game hit an error (${String(event.data.message).slice(0, 120)}). `);
    const fix = Object.assign(document.createElement("button"), {
        type: "button",
        className: "button",
        textContent: "Ask the model to fix it",
    });
    fix.onclick = () =>
        change(
            `The game crashed with this error: ${String(event.data.message).slice(0, 300)} (line ${event.data.line}). Fix it.`,
        );
    banner.append(fix);
});

function download() {
    const link = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(new Blob([state.page], { type: "text/html" })),
        download: "my-game.html",
    });
    link.click();
}

async function share() {
    const text = await encodeShare(state.page);
    const url = `${appUrl()}#game=${text}`;
    try {
        await navigator.clipboard.writeText(url);
        notice(
            `Link copied (${Math.round(url.length / 1000)} KB). It plays without any sign-in. Very long links may be cut off by some chat apps: Download gives one file instead.`,
        );
    } catch {
        notice("The browser would not let this page copy to the clipboard. Use Download instead.", "error");
    }
}

// ---- start
$("#sign-in").onclick = () => startSignIn();
$("#sign-out").onclick = () => {
    clearSession();
    renderSession();
};
$("#forge").onclick = () => forge();
$("#apply").onclick = () => change($("#change").value.trim() || "Make the game a little more fun.");
$("#download").onclick = download;
$("#share").onclick = () => share().catch((error) => notice(error.message, "error"));

const outcome = completeSignIn();
if (outcome && outcome !== "ok") notice(PROBLEMS[outcome], "error");
renderSession();
if (location.hash.startsWith("#game=")) {
    decodeShare(location.hash.slice(6))
        .then((page) => {
            state.page = page;
            $("#game").srcdoc = page;
            $("#stage").hidden = false;
            $("#tools").hidden = true;
            $("#title").textContent = "A shared game";
            notice("This game was shared with you. It plays without a sign-in; sign in above to make your own.");
        })
        .catch(() => notice("That shared link could not be read.", "error"));
}
