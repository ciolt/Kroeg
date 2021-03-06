export function get(object: ASObject, name: string): any[] {
    if (object == null) debugger;
    if (name in object) {
        if (Array.isArray(object[name])) return object[name];
        return [object[name]];
    }

    return [];
}

export function take(object: ASObject, name: string, def: any = ""): any {
    if (name in object) return get(object, name)[0];
    return def;
}

export function has(object: ASObject, name: string): boolean {
    return name in object;
}

export function contains(object: ASObject, name: string, value: any): boolean {
    return get(object, name).indexOf(value) != -1;
}

export function containsAny(object: ASObject, name: string, values: any[]): boolean {
    const data = get(object, name);
    for(let value of values) if (data.indexOf(value) != -1) return true;
    return false;
}

export function set(object: ASObject, name: string, value: any) {
    if (name in object) {
        if (Array.isArray(object[name])) object[name].push(value);
        else object[name] = [object[name], value];
    }

    object[name] = value;
}

export function clear(object: ASObject, name: string) {
    if (name in object) delete object[name];
}

export class ASObject {
    public id: string;
    [name: string]: any;
}