export = factory;

declare class Options {
    open: Function;
    openReadOnly: Function;
    read: Function;
    write: Function;
    del: Function;
    stat: Function;
    close: Function;
    destroy: Function;
}

declare interface Stats {}

declare function factory(opts: Options): RandomAccess;

declare class RandomAccess<DataT=any> {
    close(): Promise<void>;
    close(callback: (err?: any) => void): void;

    del(offset: number, size: number): Promise<void>;
    del(offset: number, size: number, callback: (err?: any) => void): void;

    destroy(): Promise<void>;
    destroy(callback: (err?: any) => void): void;

    open(): Promise<void>;
    open(callback: (err?: any) => void): void;

    read(offset: number, size: number): Promise<DataT>;
    read(offset: number, size: number, callback: (err?: any, data: DataT) => void): void;

    run(req: any): void;

    stat<T extends Stats>(): Promise<T>;
    stat<T extends Stats>(callback: (stats: T) => void): void;

    write(offset: number, data: DataT): Promise<void>;
    write(offset: number, data: DataT, callback: (err?: any) => void): void;
}

