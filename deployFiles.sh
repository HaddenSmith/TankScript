#!/bin/bash

SSH="/c/Windows/System32/OpenSSH/ssh.exe"
SCP="/c/Windows/System32/OpenSSH/scp.exe"
# ./deployFiles.sh -h haddensmith.com -s startup
# Code to deploy files to a remote server using SSH and SCP

while getopts h:s: flag
do
    case "${flag}" in
        h) hostname=${OPTARG};;
        s) service=${OPTARG};;
    esac
done

if [[ -z "$hostname" || -z "$service" ]]; then
    printf "\nMissing required parameter.\n"
    printf "  syntax: deployFiles.sh -h <hostname> -s <service>\n\n"
    exit 1
fi

printf "\n----> Deploying files for $service to $hostname\n"

# Step 1
printf "\n----> Clear out the previous distribution on the target.\n"
"$SSH" ubuntu@$hostname << ENDSSH
rm -rf services/${service}/public
mkdir -p services/${service}/public
ENDSSH

# Step 2
printf "\n----> Copy the distribution package to the target.\n"
"$SCP" -r * ubuntu@$hostname:services/$service/public