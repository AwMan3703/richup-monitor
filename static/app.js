document.addEventListener("DOMContentLoaded", () => {
    // Dark mode toggle button
    const toggleButton = document.createElement("button");
    toggleButton.id = "darkModeToggle";
    toggleButton.textContent = "Toggle Dark Mode";
    document.body.appendChild(toggleButton);

    toggleButton.addEventListener("click", () => {
        document.body.classList.toggle("dark-mode");
    });
});

// In-memory stores
const roomLogs = {};
const messageTypes = new Set();

function containsAnySubstring(string, substrings) {
    return substrings.some(substring => string.includes(substring));
}

// Create the room box on the first message
function createRoomBox(roomId, mapId, timestamp) {
    const container = document.getElementById("roomsContainer");
    const box = document.createElement("div");
    box.classList.add("room-box");
    box.classList.add("waiting");
    box.id = `room-${roomId}`;

    const title = document.createElement("div");
    title.dataset.timestamp = timestamp
    title.classList.add("room-title");
    title.textContent = "Room ";

    const link = document.createElement("a");
    link.href = `https://richup.io/room/${roomId}`;
    link.target = "_blank";
    link.textContent = roomId;

    const mapName = document.createElement("div")
    mapName.classList.add("room-map-name")
    mapName.classList.toggle("is-relevant", ![undefined, "classic"].includes(mapId))
    mapName.textContent = (mapId || "unknown").replace("-", " ")

    title.appendChild(link);
    title.appendChild(mapName);

    const log = document.createElement("div");
    log.className = "room-log";

    box.appendChild(title);
    box.appendChild(log);
    container.insertBefore(box, container.firstChild);

    roomLogs[roomId] = log;
}

// Create a checkbox to filter a given message type
function createFilterCheckbox(type) {
    const filtersList = document.getElementById("filtersList");
    const label = document.createElement("label");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.classList.add("filter-checkbox");
    checkbox.dataset.type = type;                // tag checkbox with its type

    checkbox.addEventListener("change", () => {
        toggleMessageTypeVisibility(type, checkbox.checked);
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${type}`));

    filtersList.appendChild(label);
}

// Show or hide all messages of a given type
function toggleMessageTypeVisibility(type, show) {
    const selector = `.${CSS.escape(`type-${type}`)}`;
    document.querySelectorAll(selector).forEach(el => {
        el.style.display = show ? "" : "none";
    });
}

// Render a JSON payload as styled HTML
function renderStyledJSON(obj) {
    const container = document.createElement("div");
    container.className = "json-payload";

    for (const key in obj) {
        const line = document.createElement("div");
        line.className = "json-line";

        const keySpan = document.createElement("span");
        keySpan.className = "json-key";
        keySpan.textContent = key + ": ";

        const valueSpan = document.createElement("span");
        valueSpan.className = "json-value";
        valueSpan.textContent =
            typeof obj[key] === "object" ? JSON.stringify(obj[key]) : obj[key];

        line.appendChild(keySpan);
        line.appendChild(valueSpan);
        container.appendChild(line);
    }

    return container.outerHTML;
}

// Append a new message to the appropriate room log
function logMessage(room, rawMessage) {
    if (!roomLogs[room.id]) {
        createRoomBox(room.id, room.mapId, new Date().toLocaleString().split(", ")[1]);
    }

    let eventName = "unknown";
    let payload = null;

    try {
        const match = rawMessage.match(/^[^,]+,(.*)/);
        if (match) {
            const parsed = JSON.parse(match[1]);
            if (Array.isArray(parsed) && parsed.length === 2) {
                eventName = parsed[0];
                payload = parsed[1];
            }
        }
    } catch {
        return;
    }

    const timestamp = payload?.timestamp
        ? new Date(payload?.timestamp).toLocaleTimeString()
        : new Date().toLocaleTimeString();

    const messageElement = document.createElement("div");
    messageElement.classList.add("log-entry", `type-${eventName}`);
    messageElement.innerHTML = `
        <span class="timestamp">${timestamp}</span>
        — <span class="event-name">${eventName}</span>
        ${renderStyledJSON(payload || {})}
    `;

    // Hide if unchecked
    const filterCheckbox = document.querySelector(`input.filter-checkbox[data-type="${eventName}"]`);
    if (filterCheckbox && !filterCheckbox.checked) {
        messageElement.style.display = "none";
    }

    const box = document.getElementById(`room-${room.id}`);

    // Special handling
    // room-deleted -> add a button
    if (eventName === "room-deleted") {
        const button = document.createElement("button");
        button.textContent = "Remove Log";
        button.style.marginTop = "0.5rem";
        button.onclick = () => {
            const box = document.getElementById(`room-${room.id}`);
            if (box) box.remove();
        };
        messageElement.appendChild(button);
    }
    // room map changed -> change map name
    else if (eventName === "game-room-updated" && !!payload?.map?.id) {
        if (!box) return;

        const mapNameEl = box.querySelector(".room-map-name");
        if (!mapNameEl) return;

        mapNameEl.textContent = payload?.map?.id.replace("-", " ");
        mapNameEl.classList.toggle("is-relevant", ![undefined, "classic"].includes(payload?.map?.id))
    }
    // game-started/is playing, game-ended -> update border
    else if (containsAnySubstring(eventName, ["game-started", "dice-rolled", "trade", "purchase", "auction"])) {
        box.classList.remove("waiting")
        box.classList.add("playing")
        box.classList.remove("ended")
    }
    else if (eventName === "game-ended") {
        box.classList.remove("waiting")
        box.classList.remove("playing")
        box.classList.add("ended")
    }

    roomLogs[room.id].appendChild(messageElement);
    roomLogs[room.id].scrollTop = roomLogs[room.id].scrollHeight;

    if (!messageTypes.has(eventName)) {
        messageTypes.add(eventName);
        createFilterCheckbox(eventName);
    }
}


// Set up WebSocket and start receiving messages
const ws = new WebSocket(`ws://${location.host}/ws`);
ws.onopen = () => {
    // initial subscription (backend still ignores this now)
    ws.send(JSON.stringify({ messageTypes: ["chat:message-received"] }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    logMessage(data.room, data.message);
};
