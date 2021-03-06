import { Session } from "./Session";
import { ASObject } from "./AS";
import * as jsonld from "jsonld";

export type ChangeHandler = (oldValue: ASObject, newValue: ASObject) => void;
export type NotifyHandler = (id: string) => void;

export class StoreActivityToken {
    public items: {[id: string]: ChangeHandler[]} = {};

    public addToHandler(id: string, handler: ChangeHandler) {
        if (!(id in this.items)) this.items[id] = [];
        this.items[id].push(handler);
    }
}

export class NotifyToken {
    public id: string;
    public func: NotifyHandler;
}

let _documentStore: {[url: string]: jsonld.DocumentObject} = {};
let _promiseDocumentStore: {[url: string]: Promise<jsonld.DocumentObject>} = {};

function _deflatten(obj: {[a: string]: any}): {[id: string]: {[a: string]: any}} {
    var stack = [obj];
    var result: {[id: string]: {[a: string]: any}} = {};
    while (stack.length > 0) {
        let item = stack.shift();
        for (let key in item) {
            if (key.startsWith("@")) continue;
            for (let i in item[key]) {
                if ("@id" in item[key][i] && Object.keys(item[key][i]).filter(a => !a.startsWith("@")).length > 0) {
                    stack.push(item[key][i]);
                    item[key][i] = {"@id": item[key][i]["@id"]};
                } else if ("@list" in item[key][i]) {
                    let list = item[key][i]["@list"]
                    for (let j in list) {
                        if ("@id" in list[j] && Object.keys(list[j]).filter(a => !a.startsWith("@")).length > 0) {
                            stack.push(list[j]);
                            list[j] = {"@id": list[j]["@id"]};
                        }
                    }
                }
            }
        }
        result[item["@id"]] = item;
    }
    return result;
}

async function _get(url: string): Promise<jsonld.DocumentObject> {
    let headers = new Headers();
    headers.append("Accept", "application/ld+json");

    console.log("Fetching " + url);

    let result = await fetch(url, { headers });
    let json = await result.text();
    let doc = {documentUrl: url, document: json};
    _documentStore[url] = doc;
    return doc;
}

function loadDocument(url: string, callback: (err: Error | null, documentObject: jsonld.DocumentObject) => void) {
    if (url in _documentStore) {
        callback(null, _documentStore[url]);
    } else {
        if (!(url in _promiseDocumentStore))
            _promiseDocumentStore[url] = _get(url);
        _promiseDocumentStore[url].then(a => callback(null, a), a => callback(a, null));
    }
}

export class EntityStore {
    private _handlers: {[id: string]: ChangeHandler[]} = {};
    private _cache: {[id: string]: ASObject} = {};
    private _get: {[id: string]: Promise<ASObject>} = {};

    private _eventSources: {[id: string]: any} = {};
    private _listeners: {[id: string]: NotifyHandler[]} = {};

    constructor(public session: Session) {
        if ("preload" in window) {
            let preload = (window as any).preload;
            for (let item in preload)
                this._addToCache(item, preload[item]);
        }

        this._updateCounter();
    }

    public listenCollection(id: string, func: NotifyHandler): NotifyToken {
       console.log(`Request for ${id}`);
        if (!(id in this._eventSources)) {
            console.log(`Listening to ${id}....`);
            let newSource = this._eventSources[id] = new ((window as any).EventSource)(id + "?authorization=" + this.session.token);
            newSource.addEventListener("message", (e: any) => this._handleSource(id, JSON.parse(e.data)));
            this._listeners[id] = [];
        }

        this._listeners[id].push(func);
        let token = new NotifyToken();
        token.func = func;
        token.id = id;
        return token;
    }

    private _updateCounter() {
        let gets = Object.keys(this._get);
        let counter = "???";
        if (gets.length == 0) {
            counter = `Loaded ${Object.keys(this._cache).length} items in cache`;
        } else if (gets.length == 1) {
            counter = `Loading ${gets[0]}...`;
        } else {
            counter = `Loading ${gets.length} items...`;
        }

        this._addToCache("kroeg:storeState", {id: "kroeg:storeState", counter});
    }

    public unlisten(token: NotifyToken) {
        console.log(`Unlisten to ${JSON.stringify(token)}`);
        let id = token.id;
        this._listeners[id].splice(this._listeners[id].indexOf(token.func), 1);

        if (this._listeners[id].length == 0) {
            this._eventSources[id].close();
            delete this._eventSources[id];
        }
    }

    private async _handleSource(id: string, data: ASObject) {
        console.log(id, data);
        data = await this._processGet(data.id, data);
        for (let listener of this._listeners[id]) {
            listener(data.id);
        }
    }

    private _addToHandler(id: string, handler: ChangeHandler) {
        if (!(id in this._handlers)) this._handlers[id] = [];
        this._handlers[id].push(handler);
    }

    private _removeFromHandler(id: string, handler: ChangeHandler) {
        this._handlers[id].splice(this._handlers[id].indexOf(handler), 1);
    }
    
    public register(handlers: {[id: string]: ChangeHandler}, existing?: StoreActivityToken): StoreActivityToken {
        if (existing == null) existing = new StoreActivityToken();
        for (let id in handlers) {
            this._addToHandler(id, handlers[id]);
            existing.addToHandler(id, handlers[id]);
        }

        return existing;
    }

    public deregister(handler: StoreActivityToken) {
        for (let id in handler.items) {
            for (let item of handler.items[id])
                this._removeFromHandler(id, item);
        }

        handler.items = {};
    }

    private static _eq(a: any, b: any) {
        if (typeof a == "string" && typeof b == "string") return a == b || (a.startsWith("_:") && b.startsWith("_:"));
        return a == b;
    }

    private static _equals(a: ASObject, b: ASObject) {
        let prevKeys = Object.getOwnPropertyNames(a);
        let newKeys = Object.getOwnPropertyNames(b);
        if (prevKeys.length != newKeys.length)
            return false;

        for (let key of prevKeys) {
            if (newKeys.indexOf(key) == -1) return false;
            if (Array.isArray(a[key]) != Array.isArray(b[key])) return false;
            if (Array.isArray(a[key])) {
                if (a[key].length != b[key].length) return false;

                for (let i = 0; i < a[key].length; i++) {
                    if (!EntityStore._eq(a[key][i], b[key][i])) return false;
                }
            } else if (typeof a[key] == "object" && typeof b[key] == "object") {
                if (!EntityStore._equals(a[key], b[key])) return false;
            } else {
                if (!EntityStore._eq(a[key], b[key])) return false;
            }
        }

        return true;
    }

    private _addToCache(id: string, obj: ASObject) {
        let prev: ASObject = undefined
        if (id in this._cache)
            prev = this._cache[id];

        if (prev !== undefined && EntityStore._equals(prev, obj))
            return;

        this._cache[id] = obj;

        if (id in this._handlers)
            for (let handler of this._handlers[id])
                handler(prev, obj);

    }

    public internal(id: string, obj: ASObject) {
        this._addToCache("kroeg:" + id, obj);
        return "kroeg:" + id;
    }

    public async search(type: "emoji"|"actor", data: string): Promise<ASObject[]> {
        let response = await this.session.authFetch(`${this.session.search}?type=${type}&data=${encodeURIComponent(data)}`);
        let json = await response.json();
        for (let item of json) {
            this._cache[item.id] = item; // bypass cache because stupid reasons
        }
        return json;
    }

    public clear() {
        this._cache = {};
        for (let item in this._handlers) {
            if (item.startsWith("kroeg:")) continue;
            this._processGet(item);
        }
    }

    private async loadDocument(url: string, callback: (err: Error | null, documentObject: jsonld.DocumentObject) => void) {
        try {
            let response = await this.session.authFetch(url);
            let data = await response.json();
            callback(null, data);
        } catch (e) {
            callback(e, null);
        }
    }

    private async _processGet(id: string, data?: ASObject): Promise<ASObject> {
        let processor = new jsonld.JsonLdProcessor();
        
        this._updateCounter();
        try {
            if (id == null) return;
            if (data === undefined) data = await this.session.getObject(id);
            let context = {"@context": ["https://www.w3.org/ns/activitystreams", window.location.origin + "/render/context"] };
            let expanded = await processor.expand(data, { documentLoader: loadDocument }) as any;
            let compacted = await processor.compact({"@graph": _deflatten(expanded[0])}, context as any, { documentLoader: loadDocument }) as any;

            for (let item in compacted) {
                if (item.startsWith("@")) continue;
                this._addToCache(compacted[item].id, compacted[item]);
            } 
        } finally {
            delete this._get[id];
            this._updateCounter();
            if (!(id in this._cache) && data !== undefined) return this._cache[data.id];
            return this._cache[id];
        }
    }

    public get(id: string, cache: boolean = true): Promise<ASObject> {
        if (id in this._cache && cache)
            return Promise.resolve(this._cache[id]);

        if (id in this._get)
            return this._get[id];

        this._get[id] = this._processGet(id);

        return this._get[id];
    }
}