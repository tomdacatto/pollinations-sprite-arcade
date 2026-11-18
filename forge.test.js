import assert from "node:assert/strict";
import test from "node:test";
import { buildPage, changeMessages, decodeShare, encodeShare, gameMessages, keyMagenta, parseGame } from "./forge.js";

const GAME =
    "<!doctype html><html><head><title>x</title></head><body><canvas></canvas><script>ctx.drawImage(SPRITES.ship, 0, 0)</script></body></html>";
const REPLY = (list, html = GAME) => `SPRITES:\n${list}\n\`\`\`html\n${html}\n\`\`\``;

test("the request names the sprite contract and carries the description", () => {
    const [system, user] = gameMessages("a rocket that dodges asteroids");
    assert.match(system.content, /window\.SPRITES\.<name>/);
    assert.equal(user.content, "The game: a rocket that dodges asteroids");
});

test("a good reply gives the sprites and the game", () => {
    const { sprites, html, error } = parseGame(REPLY("- ship: a small rocket\n- rock: a grey asteroid"));
    assert.equal(error, undefined);
    assert.deepEqual(sprites, [
        { name: "ship", prompt: "a small rocket" },
        { name: "rock", prompt: "a grey asteroid" },
    ]);
    assert.match(html, /<canvas>/);
});

test("sprite lines are checked: bad names and extras are skipped, at most four are kept", () => {
    const list = [
        "- Ship: capital",
        "- a b: spaces",
        "- ok1: fine",
        "- ok1: duplicate",
        "- s2: x",
        "- s3: x",
        "- s4: x",
        "- s5: x",
    ].join("\n");
    const { sprites } = parseGame(REPLY(list, GAME.replace("SPRITES.ship", "SPRITES.ok1")));
    assert.deepEqual(
        sprites.map((s) => s.name),
        ["ok1", "s2", "s3", "s4"],
    );
});

test("a reply without a game, a canvas, or with unlisted sprites is refused with a reason", () => {
    assert.match(parseGame("Sure! Here is a game.").error, /html block/);
    assert.match(parseGame(REPLY("- ship: x", "<p>hi</p>")).error, /no canvas/);
    assert.match(parseGame(REPLY("- rock: a rock")).error, /not listed: ship/);
    assert.match(parseGame(REPLY("- ship: x", `<canvas></canvas>${"x".repeat(70000)}`)).error, /too large/);
    // Square-bracket access counts as use too.
    assert.match(parseGame(REPLY("- rock: a rock", "<canvas></canvas><script>SPRITES['boss']</script>")).error, /boss/);
});

test("a repair keeps the sprites it already has instead of reading a new list", () => {
    const known = [{ name: "ship", prompt: "p" }];
    const { sprites, html } = parseGame(`\`\`\`html\n${GAME}\n\`\`\``, known);
    assert.deepEqual(sprites, known);
    assert.ok(html);
    const messages = changeMessages(
        [
            { role: "user", content: "u" },
            { role: "assistant", content: "r" },
        ],
        "It crashed: x is not defined",
    );
    assert.deepEqual(
        messages.map((m) => m.role),
        ["user", "assistant", "user"],
    );
    assert.match(messages[2].content, /same sprite names/);
});

test("keying: magenta becomes transparent, an edge is feathered and de-fringed, other colours stay", () => {
    const px = new Uint8ClampedArray([
        255,
        0,
        255,
        255, // pure magenta
        190,
        20,
        200,
        255, // the purple the model really draws
        200,
        140,
        200,
        255, // a pale pink edge pixel
        220,
        30,
        30,
        255, // a red rocket nose
        40,
        80,
        200,
        255, // blue
        250,
        250,
        250,
        255, // white
    ]);
    keyMagenta(px);
    assert.deepEqual([px[3], px[7]], [0, 0]);
    assert.ok(px[11] > 0 && px[11] < 255, "the edge is partly transparent");
    assert.ok(px[8] <= px[9] + 30 && px[10] <= px[9] + 30, "the edge pink is pulled out");
    assert.deepEqual([...px.slice(12)], [220, 30, 30, 255, 40, 80, 200, 255, 250, 250, 250, 255]);
});

test("the page puts the sprites and the error hook first, in a head, a bare html tag, or no tags at all", () => {
    const sprites = { ship: "data:image/png;base64,AAA" };
    const withHead = buildPage(GAME, sprites);
    assert.ok(withHead.indexOf("window.SPRITES") < withHead.indexOf("<title>"));
    assert.match(withHead, /^<!doctype html>/);
    assert.match(buildPage("<html><body><canvas></canvas></body></html>", sprites), /<html><head><script>/);
    assert.match(buildPage("<canvas></canvas>", sprites), /^<!doctype html><meta charset="utf-8"><script>/);
    // A sprite value can never close the script tag early.
    assert.ok(!buildPage(GAME, { x: "</script><b>" }).includes("</script><b>"));
});

test("a shared game survives the trip through a URL fragment", async () => {
    const page = buildPage(GAME, { ship: `data:image/png;base64,${"QUJD".repeat(40000)}` });
    const text = await encodeShare(page);
    assert.match(text, /^[A-Za-z0-9_-]+$/);
    assert.equal(await decodeShare(text), page);
});
