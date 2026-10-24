/* Roku over the home network: its External Control Protocol is plain HTTP on
   port 8060 (POST /keypress/<key>, GET /query/device-info). Devices live in the
   configuration's `networkDevices`, so adding or removing one is an ordinary
   owner-only, revision-checked configuration write. */
#ifndef LOCAL_ROKU_PORT
#define LOCAL_ROKU_PORT 8060
#endif
#define LOCAL_ROKU_MAX 8
#define LOCAL_ROKU_TIMEOUT_MS 2500

struct roku_command { const char *name, *key; int tv_only; };
/* The names are the ones the remote UI already recognises (Up, OK, Volume up,
   ...), so a Roku fills the standard buttons. "Enter" and "Backspace" are not
   here: Enter would read as OK, and both belong to the keyboard. */
static const struct roku_command roku_commands[] = {
    {"Home", "Home", 0}, {"Back", "Back", 0}, {"Up", "Up", 0}, {"Down", "Down", 0},
    {"Left", "Left", 0}, {"Right", "Right", 0}, {"OK", "Select", 0}, {"Menu", "Info", 0},
    {"Replay", "InstantReplay", 0}, {"Rewind", "Rev", 0}, {"Play", "Play", 0},
    {"Fast forward", "Fwd", 0}, {"Search", "Search", 0},
    {"Power", "Power", 1}, {"Power on", "PowerOn", 1}, {"Power off", "PowerOff", 1},
    {"Volume up", "VolumeUp", 1}, {"Volume down", "VolumeDown", 1}, {"Mute", "VolumeMute", 1},
    {"Channel up", "ChannelUp", 1}, {"Channel down", "ChannelDown", 1},
    {"TV tuner", "InputTuner", 1}, {"HDMI 1", "InputHDMI1", 1}, {"HDMI 2", "InputHDMI2", 1},
    {"HDMI 3", "InputHDMI3", 1}, {"HDMI 4", "InputHDMI4", 1}, {"AV", "InputAV1", 1},
};
#define ROKU_COMMAND_COUNT (sizeof(roku_commands) / sizeof(roku_commands[0]))

static int roku_is_tv(const cJSON *device) { return !strcmp(lj_str(device, "model"), "tv"); }

static const struct roku_command *roku_command_for(const cJSON *device, const char *name) {
    size_t i;
    for (i = 0; i < ROKU_COMMAND_COUNT; i++)
        if (!strcmp(roku_commands[i].name, name) && (!roku_commands[i].tv_only || roku_is_tv(device))) return &roku_commands[i];
    return NULL;
}

/* Only private-network IPv4 addresses: the hub must not be made to send
   requests to arbitrary hosts. (Loopback only for the test build.) */
static int roku_host_ok(const char *host) {
    struct in_addr a; unsigned char *b;
    if (!host || strlen(host) > 15 || inet_pton(AF_INET, host, &a) != 1) return 0;
    b = (unsigned char *)&a;
#ifdef LOCAL_TEST_ROKU_LOOPBACK
    if (b[0] == 127) return 1;
#endif
    return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
}

/* Favourite channels: saved on the Roku, each becomes a command named after the channel that
   launches it (POST /launch/<id>). The id goes into a URL path, so it is held to a strict set. */
#define ROKU_CHANNELS_MAX 12
#define ROKU_APPS_MAX 40
#define ROKU_APPS_BUFFER 24576
static int roku_channel_id_ok(const char *s) {
    size_t n = strlen(s), i;
    if (n == 0 || n > 24) return 0;
    for (i = 0; i < n; i++) if (!isalnum((unsigned char)s[i]) && s[i] != '.' && s[i] != '_' && s[i] != '-') return 0;
    return 1;
}
static int roku_channel_name_ok(const char *s) {
    size_t n = strlen(s);
    return safe_label(s) && n <= 40 && s[0] != ' ' && s[n - 1] != ' ';
}
/* A channel's name is also a command name, so it must not collide with the built-in ones. */
static int roku_name_reserved(const char *name) {
    size_t i;
    if (!strcasecmp(name, "DeviceInfo") || !strcasecmp(name, "ListApps")) return 1;
    for (i = 0; i < ROKU_COMMAND_COUNT; i++) if (!strcasecmp(name, roku_commands[i].name)) return 1;
    return 0;
}
static int roku_channels_valid(const cJSON *d) {
    cJSON *list = lj_get(d, "channels"), *a, *b;
    if (!list) return 1;
    if (!cJSON_IsArray(list) || cJSON_GetArraySize(list) > ROKU_CHANNELS_MAX) return 0;
    cJSON_ArrayForEach(a, list) {
        if (!cJSON_IsObject(a) || !roku_channel_id_ok(lj_str(a, "id")) || !roku_channel_name_ok(lj_str(a, "name")) || roku_name_reserved(lj_str(a, "name"))) return 0;
        for (b = a->next; b; b = b->next) if (!strcmp(lj_str(a, "id"), lj_str(b, "id")) || !strcasecmp(lj_str(a, "name"), lj_str(b, "name"))) return 0;
    }
    return 1;
}
static const cJSON *roku_channel_for(const cJSON *device, const char *name) {
    const cJSON *c;
    cJSON_ArrayForEach(c, lj_get(device, "channels")) if (!strcmp(lj_str(c, "name"), name)) return c;
    return NULL;
}

static int roku_device_valid(const cJSON *d) {
    return cJSON_IsObject(d) && safe_run_id(lj_str(d, "id")) && strlen(lj_str(d, "id")) <= 64 &&
        safe_label(lj_str(d, "name")) && strlen(lj_str(d, "name")) <= 64 &&
        !strcmp(lj_str(d, "kind"), "roku") &&
        (!strcmp(lj_str(d, "model"), "tv") || !strcmp(lj_str(d, "model"), "player")) &&
        roku_host_ok(lj_str(d, "host")) && roku_channels_valid(d);
}

/* `networkDevices` is optional; when present every entry must be well formed
   and ids must be unique. */
static int local_validate_network_devices(const cJSON *o) {
    cJSON *list = lj_get(o, "networkDevices"), *a, *b;
    if (!list) return 1;
    if (!cJSON_IsArray(list) || cJSON_GetArraySize(list) > LOCAL_ROKU_MAX) return 0;
    cJSON_ArrayForEach(a, list) {
        if (!roku_device_valid(a)) return 0;
        for (b = a->next; b; b = b->next) if (!strcmp(lj_str(a, "id"), lj_str(b, "id"))) return 0;
    }
    return 1;
}

static const cJSON *roku_find(const cJSON *config, const char *id) {
    const cJSON *d;
    cJSON_ArrayForEach(d, lj_get(config, "networkDevices")) if (!strcmp(lj_str(d, "id"), id)) return d;
    return NULL;
}

/* One short HTTP exchange. Returns the status code, or -1 when the Roku could
   not be reached, with the reason in `err`. `reply` receives the body. */
static int roku_http(const char *host, const char *method, const char *path, char *reply, size_t reply_size, char *err, size_t err_size) {
    struct sockaddr_in addr; char request[256]; size_t got = 0, sent = 0, length; int fd, status = -1; struct timeval tv;
    long long deadline; struct timespec now;
    if (reply_size) reply[0] = 0;
    memset(&addr, 0, sizeof(addr)); addr.sin_family = AF_INET; addr.sin_port = htons(LOCAL_ROKU_PORT);
    if (inet_pton(AF_INET, host, &addr.sin_addr) != 1) { snprintf(err, err_size, "The Roku's address is not valid."); return -1; }
    fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { snprintf(err, err_size, "Could not open a network connection."); return -1; }
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0 && errno != EINPROGRESS) { snprintf(err, err_size, "Could not reach the Roku."); close(fd); return -1; }
    clock_gettime(CLOCK_MONOTONIC, &now); deadline = (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000 + LOCAL_ROKU_TIMEOUT_MS;
    length = (size_t)snprintf(request, sizeof(request), "%s %s HTTP/1.0\r\nHost: %s:%d\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", method, path, host, LOCAL_ROKU_PORT);
    for (;;) {
        long long left; int ready; fd_set rd, wr;
        clock_gettime(CLOCK_MONOTONIC, &now); left = deadline - ((long long)now.tv_sec * 1000 + now.tv_nsec / 1000000);
        if (left <= 0) { snprintf(err, err_size, "The Roku did not answer in time."); close(fd); return -1; }
        FD_ZERO(&rd); FD_ZERO(&wr); FD_SET(fd, &rd); if (sent < length) FD_SET(fd, &wr);
        tv.tv_sec = left / 1000; tv.tv_usec = (left % 1000) * 1000;
        ready = select(fd + 1, &rd, sent < length ? &wr : NULL, NULL, &tv);
        if (ready < 0 && errno == EINTR) continue;
        if (ready <= 0) { snprintf(err, err_size, "The Roku did not answer in time."); close(fd); return -1; }
        if (sent < length && FD_ISSET(fd, &wr)) {
            int soerr = 0; socklen_t sl = sizeof(soerr); ssize_t n;
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &sl);
            if (soerr) { snprintf(err, err_size, "Could not reach the Roku."); close(fd); return -1; }
            n = send(fd, request + sent, length - sent, MSG_NOSIGNAL);
            if (n > 0) sent += (size_t)n; else if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK) { snprintf(err, err_size, "Could not reach the Roku."); close(fd); return -1; }
        }
        if (FD_ISSET(fd, &rd)) {
            char buf[1024]; ssize_t n = recv(fd, buf, sizeof(buf), 0);
            if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) continue;
            if (n < 0) { snprintf(err, err_size, "Could not reach the Roku."); close(fd); return -1; }
            if (n == 0) break;
            if (got + (size_t)n >= reply_size) n = (ssize_t)(reply_size - 1 - got);
            if (n > 0) { memcpy(reply + got, buf, (size_t)n); got += (size_t)n; reply[got] = 0; }
            if (reply_size && got + 1 >= reply_size) break;
        }
    }
    close(fd);
    if (got < 12 || strncmp(reply, "HTTP/", 5) != 0) { snprintf(err, err_size, "The Roku sent an unexpected reply."); return -1; }
    status = atoi(reply + 9);
    { char *body = strstr(reply, "\r\n\r\n"); size_t keep = body ? strlen(body + 4) : 0; if (body) memmove(reply, body + 4, keep + 1); else reply[0] = 0; }
    return status;
}

/* The Roku's /query/apps answer: <app id="12" type="appl" ...>Netflix</app>. Only real channels
   (type appl) with a usable id and name are kept, at most ROKU_APPS_MAX, with the XML escapes undone. */
static int roku_attr(const char *tag, const char *end, const char *name, char *out, size_t size) {
    char key[24]; const char *at, *close;
    snprintf(key, sizeof(key), " %s=\"", name);
    at = strstr(tag, key);
    if (!at || at >= end) return 0;
    at += strlen(key); close = memchr(at, '"', (size_t)(end - at));
    if (!close || (size_t)(close - at) >= size) return 0;
    memcpy(out, at, (size_t)(close - at)); out[close - at] = 0;
    return 1;
}
static void roku_unescape(char *s) {
    static const struct { const char *entity, *text; } table[] = {{"&amp;", "&"}, {"&lt;", "<"}, {"&gt;", ">"}, {"&quot;", "\""}, {"&apos;", "'"}, {"&#39;", "'"}};
    char *out = s; size_t i;
    while (*s) {
        for (i = 0; i < sizeof(table) / sizeof(table[0]); i++) {
            size_t n = strlen(table[i].entity);
            if (!strncmp(s, table[i].entity, n)) { *out++ = table[i].text[0]; s += n; goto next; }
        }
        *out++ = *s++;
    next:;
    }
    *out = 0;
}
static cJSON *roku_parse_apps(const char *xml) {
    cJSON *apps = cJSON_CreateArray(); const char *p = xml;
    while (cJSON_GetArraySize(apps) < ROKU_APPS_MAX && (p = strstr(p, "<app "))) {
        const char *open_end = strchr(p, '>'), *close; char id[40], type[24], name[160];
        if (!open_end) break;
        close = strstr(open_end, "</app>");
        if (!close) break;
        if (roku_attr(p, open_end, "id", id, sizeof(id)) && roku_attr(p, open_end, "type", type, sizeof(type)) && !strcmp(type, "appl") &&
            (size_t)(close - open_end - 1) < sizeof(name)) {
            cJSON *seen; int dup = 0;
            memcpy(name, open_end + 1, (size_t)(close - open_end - 1)); name[close - open_end - 1] = 0;
            roku_unescape(name);
            cJSON_ArrayForEach(seen, apps) if (!strcmp(lj_str(seen, "id"), id)) dup = 1;
            if (!dup && roku_channel_id_ok(id) && roku_channel_name_ok(name)) {
                cJSON *item = cJSON_CreateObject(); cJSON_AddStringToObject(item, "id", id); cJSON_AddStringToObject(item, "name", name); cJSON_AddItemToArray(apps, item);
            }
        }
        p = close + 6;
    }
    return apps;
}

/* Runs a queued "roku" operation. "DeviceInfo" is the owner's connection test
   (it reads the Roku's name and sends no key). */
static cJSON *execute_roku(const cJSON *body) {
    const char *id = lj_str(body, "deviceId"), *command = lj_str(body, "command");
    char reply[2048], err[160] = "", path[96], message[256]; int status; cJSON *config = local_config(), *result;
    const cJSON *device = config ? roku_find(config, id) : NULL; const struct roku_command *known;
    if (!device) { cJSON_Delete(config); return command_result(0, "This Roku is no longer set up on the hub."); }
    if (!strcmp(command, "DeviceInfo")) {
        status = roku_http(lj_str(device, "host"), "GET", "/query/device-info", reply, sizeof(reply), err, sizeof(err));
        if (status == 200) {
            char *start = strstr(reply, "<friendly-device-name>"), *end = start ? strstr(start, "</friendly-device-name>") : NULL;
            if (end) { start += strlen("<friendly-device-name>"); if (end - start > 80) end = start + 80; snprintf(message, sizeof(message), "%.*s", (int)(end - start), start); }
            else snprintf(message, sizeof(message), "Roku answered");
            result = command_result(1, message);
        } else result = command_result(0, status < 0 ? err : "The Roku refused the request. Turn on network control in its settings.");
        cJSON_Delete(config); return result;
    }
    if (!strcmp(command, "ListApps")) {
        char *xml = malloc(ROKU_APPS_BUFFER);
        if (!xml) { cJSON_Delete(config); return command_result(0, "Not enough memory to list channels."); }
        status = roku_http(lj_str(device, "host"), "GET", "/query/apps", xml, ROKU_APPS_BUFFER, err, sizeof(err));
        if (status == 200) {
            cJSON *apps = roku_parse_apps(xml);
            snprintf(message, sizeof(message), "%d channels", cJSON_GetArraySize(apps));
            result = command_result(1, message); cJSON_AddItemToObject(result, "apps", apps);
        } else result = command_result(0, status < 0 ? err : "The Roku refused the request. Turn on network control in its settings.");
        free(xml); cJSON_Delete(config); return result;
    }
    known = roku_command_for(device, command);
    if (!known) {
        const cJSON *channel = roku_channel_for(device, command);
        if (!channel) { cJSON_Delete(config); return command_result(0, "This Roku has no such command."); }
        snprintf(path, sizeof(path), "/launch/%s", lj_str(channel, "id"));
        status = roku_http(lj_str(device, "host"), "POST", path, reply, sizeof(reply), err, sizeof(err));
        if (status == 200) result = command_result(1, "launched");
        else result = command_result(0, status < 0 ? err : "The Roku couldn't open that channel. Is it still installed?");
        cJSON_AddStringToObject(result, "deviceId", id); cJSON_AddStringToObject(result, "command", command);
        cJSON_Delete(config); return result;
    }
    snprintf(path, sizeof(path), "/keypress/%s", known->key);
    status = roku_http(lj_str(device, "host"), "POST", path, reply, sizeof(reply), err, sizeof(err));
    if (status == 200) result = command_result(1, "sent");
    else result = command_result(0, status < 0 ? err : "The Roku refused the key. Turn on network control in its settings.");
    cJSON_AddStringToObject(result, "deviceId", id); cJSON_AddStringToObject(result, "command", command);
    cJSON_Delete(config); return result;
}

/* Text typed on the phone. Printable characters, other UTF-8 characters, Backspace
   (U+0008) and Enter (newline). At most ROKU_TYPE_MAX characters per request. */
#define ROKU_TYPE_MAX 64
#define ROKU_TYPE_MS 8000  /* start no new key press after this; the last one can still take LOCAL_ROKU_TIMEOUT_MS */
/* Length in bytes of the UTF-8 character at `p`, or 0 if it is not well formed. */
static size_t roku_utf8_length(const unsigned char *p) {
    size_t n, i;
    if (p[0] < 0x80) return 1;
    if (p[0] >= 0xC2 && p[0] <= 0xDF) n = 2; else if (p[0] >= 0xE0 && p[0] <= 0xEF) n = 3; else if (p[0] >= 0xF0 && p[0] <= 0xF4) n = 4; else return 0;
    for (i = 1; i < n; i++) if ((p[i] & 0xC0) != 0x80) return 0;
    if ((p[0] == 0xE0 && p[1] < 0xA0) || (p[0] == 0xED && p[1] > 0x9F) || (p[0] == 0xF0 && p[1] < 0x90) || (p[0] == 0xF4 && p[1] > 0x8F)) return 0;
    return n;
}
static int roku_type_valid(const char *text) {
    const unsigned char *p = (const unsigned char *)text; size_t units = 0;
    if (!text || !p[0]) return 0;
    while (*p) {
        size_t n = roku_utf8_length(p);
        if (!n || (n == 1 && *p < 0x80 && (*p == 0x7F || (*p < 0x20 && *p != '\b' && *p != '\n')))) return 0;
        if (p[0] == 0xC2 && p[1] >= 0x80 && p[1] <= 0x9F) return 0;                    /* C1 controls */
        if (p[0] == 0xE2 && p[1] == 0x80 && (p[2] == 0xA8 || p[2] == 0xA9)) return 0;   /* line/paragraph separators */
        if (++units > ROKU_TYPE_MAX) return 0;
        p += n;
    }
    return 1;
}

/* The ECP path for the character (or Backspace/Enter) at `p`, which is `n` bytes. */
static void roku_key_path(const unsigned char *p, size_t n, char *path, size_t size) {
    size_t at, i;
    if (*p == '\b') { snprintf(path, size, "/keypress/Backspace"); return; }
    if (*p == '\n') { snprintf(path, size, "/keypress/Enter"); return; }
    at = (size_t)snprintf(path, size, "/keypress/Lit_");
    for (i = 0; i < n && at < size; i++) {
        if (p[i] < 0x80 && isalnum(p[i])) at += (size_t)snprintf(path + at, size - at, "%c", p[i]);
        else at += (size_t)snprintf(path + at, size - at, "%%%02X", p[i]);
    }
}
static size_t roku_type_count(const char *text) {
    const unsigned char *p = (const unsigned char *)text; size_t n = 0, len;
    while (*p && (len = roku_utf8_length(p))) { p += len; n++; }
    return n;
}
/* Typed text can be a password: once the operation ends only its length stays in the stored record. */
static void roku_redact_typed(cJSON *op) {
    cJSON *request = lj_get(op, "request"); size_t count;
    if (!request) return;
    count = roku_type_count(lj_str(request, "text"));
    cJSON_DeleteItemFromObjectCaseSensitive(request, "text");
    cJSON_AddNumberToObject(request, "characters", (double)count);
}

/* Runs a queued "roku-type" operation: one key press per character, in order.
   Stops at the first one the Roku does not take and says how far it got. */
static cJSON *execute_roku_type(const cJSON *body) {
    const char *id = lj_str(body, "deviceId"), *text = lj_str(body, "text"); const unsigned char *p = (const unsigned char *)text;
    char reply[256], err[160] = "", path[96], message[256]; cJSON *config = local_config(), *result; const cJSON *device = config ? roku_find(config, id) : NULL;
    size_t done = 0, total = roku_type_count(text); struct timespec start, now;
    if (!device) { cJSON_Delete(config); return command_result(0, "This Roku is no longer set up on the hub."); }
    if (!roku_type_valid(text)) { cJSON_Delete(config); return command_result(0, "That text can't be typed."); }
    clock_gettime(CLOCK_MONOTONIC, &start);
    while (*p) {
        size_t n = roku_utf8_length(p); int status;
        roku_key_path(p, n, path, sizeof(path));
        clock_gettime(CLOCK_MONOTONIC, &now);
        if ((now.tv_sec - start.tv_sec) * 1000 + (now.tv_nsec - start.tv_nsec) / 1000000 > ROKU_TYPE_MS) { snprintf(err, sizeof(err), "The Roku was too slow."); status = -1; }
        else status = roku_http(lj_str(device, "host"), "POST", path, reply, sizeof(reply), err, sizeof(err));
        if (status != 200) {
            snprintf(message, sizeof(message), "Typed %u of %u characters. %s", (unsigned)done, (unsigned)total, status < 0 ? err : "The Roku refused a key. Turn on network control in its settings.");
            result = command_result(0, message);
            /* So a client can tell how much arrived and avoid typing it twice. */
            cJSON_AddNumberToObject(result, "typed", (double)done); cJSON_AddNumberToObject(result, "total", (double)total);
            cJSON_Delete(config); return result;
        }
        done++; p += n;
    }
    result = command_result(1, "typed"); cJSON_AddStringToObject(result, "deviceId", id);
    cJSON_AddNumberToObject(result, "typed", (double)done); cJSON_AddNumberToObject(result, "total", (double)total);
    cJSON_Delete(config); return result;
}

/* GET /api/v1/network/devices: the same shape the remote screens already use for
   other devices, without the address. */
static void local_network_devices(int fd) {
    cJSON *config = local_config(), *out = cJSON_CreateObject(), *list = cJSON_AddArrayToObject(out, "devices"); const cJSON *d;
    cJSON_ArrayForEach(d, lj_get(config, "networkDevices")) {
        cJSON *item = cJSON_CreateObject(), *commands = cJSON_CreateArray(); size_t i;
        cJSON_AddStringToObject(item, "id", lj_str(d, "id")); cJSON_AddStringToObject(item, "name", lj_str(d, "name"));
        cJSON_AddStringToObject(item, "type", "Roku"); cJSON_AddStringToObject(item, "model", lj_str(d, "model"));
        cJSON_AddBoolToObject(item, "keyboard", 1);
        for (i = 0; i < ROKU_COMMAND_COUNT; i++) if (!roku_commands[i].tv_only || roku_is_tv(d)) {
            cJSON *c = cJSON_CreateObject(); cJSON_AddStringToObject(c, "name", roku_commands[i].name); cJSON_AddItemToArray(commands, c);
        }
        { const cJSON *channel; cJSON_ArrayForEach(channel, lj_get(d, "channels")) {
            cJSON *c = cJSON_CreateObject(); cJSON_AddStringToObject(c, "name", lj_str(channel, "name")); cJSON_AddItemToArray(commands, c);
        } }
        cJSON_AddItemToObject(item, "commands", commands); cJSON_AddItemToArray(list, item);
    }
    lj_reply(fd, "200 OK", out); cJSON_Delete(out); cJSON_Delete(config);
}
