import { 
  CoreRules,
  IJsonLangParams, InnerRules, IRulesCore, RuleHandler,
  RuleIdentifier, RuleParams, RuleResult, Rules
} from './core.types';

export class RuleCore implements IRulesCore {
  private rules: Map<string, RuleHandler>;

  constructor() {
    this.rules = new Map();
    this.registerOne({ name: CoreRules.Var }, this.getOutputValue);
    this.registerOne({ name: CoreRules.Data }, this.getDate);
  }

  /**
   * @param {IJsonLangParams} jsonLang
   * @param {Object} data.
   * @returns {RuleResult}
   * @description is the `Sync` version of jsonLang, use it to run all builtin rules and any extended `Sync` Rules
  */
  execute(rules: IJsonLangParams, data?: {}): RuleResult {
    const outputs = new Map();

    const run = this.createRunContext(outputs, data);

    return run()(rules);
  }

  /**
   * @param {IJsonLangParams} jsonLang
   * @param {Object} data.
   * @returns {Promise<RuleResult>}
   * @description is the `Async` version of jsonLang, use it to run all builtin rules and any extended `Sync/Async` Rules
  */
  executeAsync(rules: IJsonLangParams, data?: {}): Promise<RuleResult> {
    const outputs = new Map();

    const syncRun = this.createRunContext(outputs, data);
    const run = this.createAsyncRunContext(outputs, syncRun, data);

    return run()(rules);
  }

  /**
   * @param {Rules} rules - Map of Rules.
   * @returns {void}
   * @description to extend JsonLang by a Map() of rules the "Map key" is RuleIdentifier and the "Map value" is the Sync/Async RuleHandler
  */
  registerMany = (rules: Rules) => {
    rules.forEach((value: RuleHandler, key: RuleIdentifier) => this.registerOne(key, value));
  }

  /**
   * @param {RuleIdentifier} ruleIdentifier
   * @param {RuleHandler} RuleHandler.
   * @returns {void}
   * @description to extend JsonLang by adding one Sync/Async Rule`
  */
  registerOne = (ruleIdentifier: RuleIdentifier, ruleHandler: RuleHandler) => {
    this.rules.set(ruleIdentifier.name, ruleHandler);

    if (ruleIdentifier.shortcut) this.rules.set(ruleIdentifier.shortcut, ruleHandler);
  }


  private createRunContext = (outputs: Map<string, any>, data?: {}) => {

    const run = (scopedData?: any) => {
      let localData = scopedData;

      const innerRun = (jsonLang: IJsonLangParams) => {
        const { rule, inputs = [], output } = this.getRuleParams(jsonLang);

        const ruleHandler = this.rules.get(rule);
    
        if (!ruleHandler) throw Error(`The "${rule}" is not exist`);
  
        let resolvedInputs = this.resolveRuleInputs(inputs, ruleHandler, innerRun, run);

        resolvedInputs = this.getAllInputs(rule, resolvedInputs, outputs, data, localData);

        const result = <RuleResult> ruleHandler(...resolvedInputs);
    
        if (output) this.setOutputValue(output, result, outputs);
    
        return result;
      }
  
      return innerRun;
    }

    return run;
  }

  private createAsyncRunContext = (outputs: Map<string, any>, syncRun: Function, data?: {}) => {

    const run = (scopedData?: any) => {
      let localData = scopedData;

      const innerRun = async (jsonLang: IJsonLangParams) => {
        const { rule, inputs = [], output } = this.getRuleParams(jsonLang);

        const ruleHandler = this.rules.get(rule);
    
        if (!ruleHandler) throw Error(`The "${rule}" is not exist`);
  
        try {
          let resolvedInputs = await this.resolveRuleAsyncInputs(inputs, ruleHandler, innerRun, syncRun, run);
    
          resolvedInputs = this.getAllInputs(rule, resolvedInputs, outputs, data, localData);
    
          const result = await ruleHandler(...resolvedInputs);
    
          if (output) this.setOutputValue(output, result, outputs);
      
          return result;
        }
        catch (error) {
          throw Error(`Failed to Run "${rule}" cause of ${error}`);
        }
      }
      
      return innerRun;
    }

    return run;
  }


  private resolveRuleInputs = (inputs: any[], ruleHandler: RuleHandler, run: Function, runner: Function) => {
    const innerRules = this.getHandlerInnerRules(ruleHandler);

    const resolvedInputs = inputs.map((input, i) => {
      return this.isRule(input) && !innerRules.rules.includes(i) ? run(input) : input
    });

    if (innerRules.runner) resolvedInputs.splice(innerRules.runner, 0, <any> runner);

    return resolvedInputs;
  }

  private resolveRuleAsyncInputs = async (
    inputs: any[], 
    ruleHandler: RuleHandler, 
    run: Function, 
    runner: Function,
    asyncRunner: Function
  ) => {
    const innerRules = this.getHandlerInnerRules(ruleHandler);

    const resolvedInputs = [];

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const result = this.isRule(input) && !innerRules.rules.includes(i) ? await run(input) : input;
      resolvedInputs.push(result);
    }

    if (innerRules.runner) resolvedInputs.splice(innerRules.runner, 0, <any> runner);
    if (innerRules.asyncRunner) resolvedInputs.splice(innerRules.asyncRunner, 0, <any> asyncRunner);

    return resolvedInputs;
  }

  private getAllInputs(rule: string, inputs: any[], outputs: Map<string, any>, data?: {}, scopedData?: any) {
    let params = inputs;

    if (rule === CoreRules.Var) {
      params = [inputs?.[0], outputs];
    }
    else if (rule === CoreRules.Data) {
      params = inputs?.[0] === 'Local'? [scopedData] : [data];
    }

    return params;
  }

  private getRuleParams(jsonLang: IJsonLangParams) {
    const rule: string = jsonLang[RuleParams.Rule];
    const inputs = jsonLang[RuleParams.Input]
    const output = jsonLang[RuleParams.Output];

    return { rule, inputs, output };
  }

  private getHandlerInnerRules = (ruleHandler: RuleHandler) => {
    const innerRules: InnerRules = { runner: null, asyncRunner: null, rules: [] };

    this.getHandlerArgs(ruleHandler).forEach((arg, i) => {
      if (arg === '$runner') {
        innerRules.runner = i;
      }
      else if (arg === '$asyncRunner') {
        innerRules.asyncRunner = i;
      }
      else if (arg.startsWith('$rule')) {
        innerRules.rules.push(i);
      }
    });

    return innerRules;
  }
  
  private getHandlerArgs = (ruleHandler: RuleHandler) => ruleHandler
    .toString()?.match(/\((.*?)\)/)?.[1]?.split(',')?.map(i => i.trim()) || [];

  private isRule = (data: any) => (data && typeof data === 'object' && data[RuleParams.Rule])

  private setOutputValue = (out: string, value: any, outputs: Map<string, any>) => {
    outputs.set(out, value);
  }

  private getOutputValue = (varName: string, outputs: Map<string, any>) => {
    const outputValue = outputs.get(varName);

    if (!outputValue) throw Error(`The "${varName}" output value is not exist`);

    return outputValue;
  }

  private getDate = (data: any) => {
    if (!data) throw Error('There is no data passed');

    return data;
  }
}