import { Stack, StackProps } from "aws-cdk-lib";
import {
    IHostedZone,
    HostedZone
} from "aws-cdk-lib/aws-route53";
import {
    Certificate,
    CertificateProps,
    CertificateValidation,
    ICertificate
} from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";

export interface AWSAdapterCertificateStackProps extends StackProps {
    FQDN: string;
    zoneName?: string;
    certificateArn?: string;
}

export class AWSAdapterCertificateStack extends Stack {
    hostedZone: IHostedZone;
    certificate: ICertificate;
    constructor(scope: Construct, id: string, props: AWSAdapterCertificateStackProps) {
        super(scope, id, props);

        const [_, zoneName, ...MLDs] = props.FQDN?.split('.') || [];
        const domainName = [zoneName, ...MLDs].join(".");

        this.hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
            domainName,
        }) as HostedZone;

        if (props.certificateArn) {
            this.certificate = Certificate.fromCertificateArn(this, 'DnsValidatedCertificate',
                props.certificateArn
            );
        } else {
            const certProps: any = {
                domainName: props.FQDN!,
                validation: CertificateValidation.fromDns(this.hostedZone),
            };
            if(props.FQDN.startsWith('www.')) {
                certProps['subjectAlternativeNames'] = [
                    props.FQDN.substring(4)
                ];
            }
            this.certificate = new Certificate(this, 'DnsValidatedCertificate', certProps);
        }
    }
}