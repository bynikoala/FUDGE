///<reference path="../Light/Light.ts"/>
namespace FudgeCore {
 
  /**
   * Defines identifiers for the various types of light this component can provide.  
   */
  // export let LIGHT_TYPE: { [type: string]: string } = {
  export enum LIGHT_TYPE {
    AMBIENT = "LightAmbient",
    DIRECTIONAL = "LightDirectional",
    POINT = "LightPoint",
    SPOT = "LightSpot"
  }
 /**
   * Attaches a {@link Light} to the node
   * @authors Jirka Dell'Oro-Friedl, HFU, 2019
   */
  export class ComponentLight extends Component {
    public static readonly iSubclass: number = Component.registerSubclass(ComponentLight);
    // private static constructors: { [type: string]: General } = { [LIGHT_TYPE.AMBIENT]: LightAmbient, [LIGHT_TYPE.DIRECTIONAL]: LightDirectional, [LIGHT_TYPE.POINT]: LightPoint, [LIGHT_TYPE.SPOT]: LightSpot };
    public mtxPivot: Matrix4x4 = Matrix4x4.IDENTITY();
    public light: Light = null;

    constructor(_light: Light = new LightAmbient()) {
      super();
      this.singleton = false;
      this.light = _light;
    }

    public setType<T extends Light>(_class: new () => T): void {
      let mtrOld: Mutator = {};
      if (this.light)
        mtrOld = this.light.getMutator();

      this.light = new _class();
      this.light.mutate(mtrOld);
    }

    public serialize(): Serialization {
      let serialization: Serialization = {
        pivot: this.mtxPivot.serialize(),
        light: Serializer.serialize(this.light)
      };
      return serialization;
    }

    public async deserialize(_serialization: Serialization): Promise<Serializable> {
      this.mtxPivot.deserialize(_serialization.pivot);
      this.light = await <Promise<Light>>Serializer.deserialize(_serialization.light);
      return this;
    }

    public getMutator(): Mutator {
      let mutator: Mutator = super.getMutator(true);
      mutator.type = this.light.getType().name;
      return mutator;
    }

    public getMutatorAttributeTypes(_mutator: Mutator): MutatorAttributeTypes {
      let types: MutatorAttributeTypes = super.getMutatorAttributeTypes(_mutator);
      if (types.type)
        types.type = LIGHT_TYPE;
      return types;
    }

    public async mutate(_mutator: Mutator): Promise<void> {
      let type: string = _mutator.type;
      if (type != this.light.constructor.name)
      this.setType(Serializer.getConstructor<Light>(type));

      delete (_mutator.type); // exclude light type from further mutation
      super.mutate(_mutator);
      _mutator.type = type; // reconstruct mutator
    }
  }
}
